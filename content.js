// ======================
// Country / Text Helpers
// ======================
const countryNameToCode = {
    "United States": "US",
    "Canada": "CA",
    "Morocco": "MA",
    "Japan": "JP",
    "South Korea": "KR",
    "United Kingdom": "GB",
    "France": "FR",
    "Germany": "DE",
    // add more as needed
};

function getCountryFromLocation(location) {
    if (!location) return "Unknown";
    for (const name of Object.keys(countryNameToCode)) {
        if (location.toLowerCase().includes(name.toLowerCase())) {
            return name;
        }
    }
    return location || "Unknown";
}

// ======================
// Cache + Queue + Rate Limit
// ======================
const userLocationCache = new Map();
const requestQueue = [];
const seenUsers = new Set();

const userBackoffIndex = new Map();
const userBackoffUntil = new Map();
const backoffSequence = [
    60000,   // 1 minute
    120000,  // 2 minutes
    300000,  // 5 minutes
    600000,  // 10 minutes
    900000   // 15 minutes (cap)
];

let isProcessing = false;
let globalRateLimitUntil = 0;

// NEW: Track when each user was added to queue
const userQueueTimestamp = new Map();
const QUEUE_STALE_THRESHOLD = 100000;  // 30 seconds

function isValidLocation(location) {
    if (!location) return false;
    const l = String(location).trim().toLowerCase();
    if (!l) return false;
    if (l === "unknown") return false;
    return true;
}

function fetchAccountLocation(screenName) {
    if (userLocationCache.has(screenName)) {
        console.log(`[CACHE HIT] ${screenName}`);
        return Promise.resolve(userLocationCache.get(screenName));
    }

    // Check if already in queue - don't add duplicates
    const alreadyQueued = requestQueue.some(item => item.screenName === screenName);
    if (alreadyQueued) {
        console.log(`[QUEUE] ${screenName} already queued, skipping`);
        return Promise.resolve({ username: screenName, location: "Unknown" });
    }

    console.log(`[QUEUE] Adding ${screenName} to queue`);
    userQueueTimestamp.set(screenName, Date.now());
    return new Promise(resolve => requestQueue.push({ screenName, resolve }));
}

// NEW: Clean stale requests from queue
function cleanStaleRequests() {
    const now = Date.now();
    const originalLength = requestQueue.length;
    
    // Remove requests older than threshold
    for (let i = requestQueue.length - 1; i >= 0; i--) {
        const item = requestQueue[i];
        const queuedTime = userQueueTimestamp.get(item.screenName) || now;
        
        if (now - queuedTime > QUEUE_STALE_THRESHOLD) {
            console.log(`[QUEUE CLEAN] Removing stale request: ${item.screenName} (${Math.round((now - queuedTime) / 1000)}s old)`);
            item.resolve({ username: item.screenName, location: "Unknown" });
            requestQueue.splice(i, 1);
            userQueueTimestamp.delete(item.screenName);
        }
    }
    
    if (requestQueue.length < originalLength) {
        console.log(`[QUEUE CLEAN] Removed ${originalLength - requestQueue.length} stale requests, ${requestQueue.length} remaining`);
    }
}

// ======================
// Queue Processor (FIXED with proper rate limit handling)
// ======================
async function processQueue() {
    if (isProcessing) return;
    if (!requestQueue.length) return;

    // Clean stale requests first
    cleanStaleRequests();
    if (!requestQueue.length) return;

    // Check global rate limit
    const now = Date.now();
    if (globalRateLimitUntil > now) {
        const waitSeconds = Math.ceil((globalRateLimitUntil - now) / 1000);
        console.warn(`[GLOBAL PAUSE] Waiting ${waitSeconds}s before processing queue`);
        return;
    }

    isProcessing = true;

    const { screenName, resolve } = requestQueue.shift();
    userQueueTimestamp.delete(screenName);  // Remove from timestamp tracking
    console.log(`[QUEUE] Processing ${screenName}, queue size: ${requestQueue.length}`);

    // Check if this user is in backoff
    const userBackoffTime = userBackoffUntil.get(screenName) || 0;
    if (userBackoffTime > now) {
        const waitSeconds = Math.ceil((userBackoffTime - now) / 1000);
        console.warn(`[USER BACKOFF] ${screenName} in backoff for ${waitSeconds}s, re-queuing at end`);
        requestQueue.push({ screenName, resolve });  // Re-queue at end
        isProcessing = false;
        return;
    }

    // Check cache again (might have been filled since enqueue)
    if (userLocationCache.has(screenName)) {
        resolve(userLocationCache.get(screenName));
        isProcessing = false;
        return;
    }

    try {
        chrome.runtime.sendMessage({ type: "get_about_info", screenName }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[MESSAGE ERROR] ${screenName}:`, chrome.runtime.lastError.message);
                resolve({ username: screenName, location: "Unknown" });
                isProcessing = false;
                return;
            }

            console.log(`[RAW RESPONSE] ${screenName}:`, response);

            // Detect rate limit
            const rateLimitDetected =
                (typeof response === "string" && response.includes("Rate limit exceeded")) ||
                (response && typeof response.error === "string" && response.error.includes("Rate limit exceeded"));

            if (rateLimitDetected) {
                const idx = userBackoffIndex.get(screenName) || 0;
                const wait = backoffSequence[Math.min(idx, backoffSequence.length - 1)];
                
                console.warn(`[RATE LIMIT] Hit for ${screenName}. Pausing ${Math.round(wait / 1000)}s (backoff idx ${idx})`);

                // Set user-specific backoff
                const backoffUntilTime = Date.now() + wait;
                userBackoffUntil.set(screenName, backoffUntilTime);
                
                // Increment backoff index for next time
                const nextIndex = Math.min(idx + 1, backoffSequence.length - 1);
                userBackoffIndex.set(screenName, nextIndex);

                // Set GLOBAL pause
                globalRateLimitUntil = Math.max(globalRateLimitUntil, Date.now() + 30000);

                // CLEAR THE ENTIRE QUEUE - no point processing old requests
                const clearedCount = requestQueue.length;
                requestQueue.forEach(item => {
                    item.resolve({ username: item.screenName, location: "Unknown" });
                    userQueueTimestamp.delete(item.screenName);
                });
                requestQueue.length = 0;
                console.warn(`[RATE LIMIT] Cleared ${clearedCount} queued requests. Will rebuild from visible users after pause.`);
                
                // Re-queue only this user (the one that hit the limit)
                requestQueue.unshift({ screenName, resolve });
                userQueueTimestamp.set(screenName, Date.now());
                
                isProcessing = false;
                return;
            }

            // Normal parsing path
            try {
                const result = response?.data?.data?.user_result_by_screen_name?.result || null;
                const username = result?.core?.screen_name || screenName;
                const location = result?.about_profile?.account_based_in || null;

                const parsed = { username, location: location ?? "Unknown" };
                console.log(`[API SUCCESS] ${username}: ${parsed.location}`);

                // Only cache valid locations
                if (isValidLocation(location)) {
                    userLocationCache.set(username, { username, location });
                    // Reset backoff on success
                    userBackoffIndex.delete(username);
                    userBackoffUntil.delete(username);
                    applyCountryToDOM(username, location);
                } else {
                    console.log(`[CACHE SKIP] Not caching ${username} - invalid location`);
                }

                resolve(parsed);

            } catch (parseErr) {
                console.error(`[API PARSE ERROR] ${screenName}:`, parseErr);
                resolve({ username: screenName, location: "Unknown" });
            }

            isProcessing = false;
        });
    } catch (err) {
        console.error(`[SEND MESSAGE EXCEPTION] ${screenName}:`, err);
        resolve({ username: screenName, location: "Unknown" });
        isProcessing = false;
    }
}

// Run queue processor every 500ms
setInterval(processQueue, 7000);

// Clean stale requests every 10 seconds
setInterval(cleanStaleRequests, 10000);

// Periodic logging
setInterval(() => {
    const now = Date.now();
    
    if (requestQueue.length > 0) {
        console.log(`[QUEUE STATUS] ${requestQueue.length} requests pending`);
    }
    
    const backoffUsers = [...userBackoffUntil.entries()]
        .filter(([, time]) => time > now)
        .map(([u, time]) => `${u}:${Math.ceil((time - now) / 1000)}s`);
    
    if (backoffUsers.length) {
        console.warn(`[BACKOFF STATE] ${backoffUsers.join(", ")}`);
    }

    if (globalRateLimitUntil > now) {
        console.warn(`[GLOBAL PAUSE] ${Math.ceil((globalRateLimitUntil - now) / 1000)}s remaining`);
    }
}, 10000); // every 10s

// ======================
// DOM Helpers
// ======================
function getAllUsernameElements() {
    return document.querySelectorAll("a[href^='/'] span span");
}

function applyCountryToDOM(username, location) {
    if (!isValidLocation(location)) return;

    const userElements = document.querySelectorAll(`a[href='/${username}'] span span`);
    if (!userElements.length) {
        console.log(`[DOM] No elements found for ${username}`);
        return;
    }

    const countryText = getCountryFromLocation(location);
    userElements.forEach(el => {
        if (!el.dataset.countryApplied) {
            el.textContent = `${countryText} | ${username}`;
            el.dataset.countryApplied = "true";
            console.log(`[DOM] Applied country text for ${username}: ${countryText}`);
        }
    });
}

// ======================
// Timeline Observation
// ======================
function updateVisibleUsers() {
    // Don't queue new users during global rate limit
    const now = Date.now();
    if (globalRateLimitUntil > now) {
        const waitSeconds = Math.ceil((globalRateLimitUntil - now) / 1000);
        console.log(`[SKIP UPDATE] Still in global pause (${waitSeconds}s remaining), not queuing new users`);
        return;
    }

    const els = getAllUsernameElements();
    const usernames = [...new Set([...els].map(el => {
        const parent = el.closest("a[href^='/']");
        if (!parent) return null;
        const match = parent.getAttribute("href")?.match(/^\/([^\/]+)$/);
        return match ? match[1] : null;
    }).filter(Boolean))];

    usernames.forEach(u => {
        if (userLocationCache.has(u)) {
            applyCountryToDOM(u, userLocationCache.get(u).location);
        } else if (!seenUsers.has(u)) {
            seenUsers.add(u);
            console.log(`[FETCH] Fetching location for ${u}`);
            fetchAccountLocation(u);
        }
    });
}

// Rebuild queue from visible users after rate limit ends
setInterval(() => {
    const now = Date.now();
    const wasInPause = globalRateLimitUntil > now;
    
    // Check if we just came out of a pause
    if (!wasInPause && globalRateLimitUntil > 0 && globalRateLimitUntil <= now) {
        console.log(`[RATE LIMIT ENDED] Rebuilding queue from visible users`);
        globalRateLimitUntil = 0;  // Reset
        updateVisibleUsers();  // Rebuild from current view
    }
}, 1000);  // Check every second

function observeTimeline() {
    const timeline = document.querySelector("main");
    if (!timeline) {
        console.log(`[OBSERVE] Timeline not found, retrying...`);
        return setTimeout(observeTimeline, 1000);
    }

    console.log(`[OBSERVE] Timeline found, observing mutations`);
    const observer = new MutationObserver(updateVisibleUsers);
    observer.observe(timeline, { childList: true, subtree: true });

    updateVisibleUsers();
}

observeTimeline();