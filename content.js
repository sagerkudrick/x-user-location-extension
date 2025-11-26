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
    60000,   // 1 min
    120000,  // 2 min
    300000,  // 5 min
    600000,  // 10 min
    900000   // 15 min
];

let globalRateLimitUntil = 0;
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const QUEUE_STALE_THRESHOLD = 30000; // 30s
const userQueueTimestamp = new Map();

// ======================
// Helpers
// ======================
function isValidLocation(location) {
    if (!location) return false;
    const l = String(location).trim().toLowerCase();
    if (!l) return false;
    if (l === "unknown") return false;
    return true;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function getAllUsernameElements() {
    return document.querySelectorAll("a[href^='/'] span span");
}

function extractUsername(el) {
    const parent = el.closest("a[href^='/']");
    if (!parent) return null;
    const match = parent.getAttribute("href")?.match(/^\/([^\/]+)$/);
    return match ? match[1] : null;
}

// ======================
// Storage Helpers
// ======================
function getFromStorage(screenName) {
    return new Promise((resolve) => {
        chrome.storage.local.get(["userLocationCache"], (result) => {
            const storedCache = result.userLocationCache || {};
            const now = Date.now();
            let cacheUpdated = false;

            // Purge old entries
            for (const [user, data] of Object.entries(storedCache)) {
                if (now - data.timestamp > TEN_DAYS_MS) {
                    console.log(`[PURGE] Removing ${user} from storage (older than 10 days)`);
                    delete storedCache[user];
                    cacheUpdated = true;
                }
            }
            if (cacheUpdated) chrome.storage.local.set({ userLocationCache: storedCache });

            if (storedCache[screenName]) {
                console.log(`[STORAGE HIT] ${screenName}`);
                resolve(storedCache[screenName]);
            } else {
                resolve(null);
            }
        });
    });
}

function saveToStorage(username, location) {
    const obj = { username, location, timestamp: Date.now() };
    chrome.storage.local.get(["userLocationCache"], (result) => {
        const storedCache = result.userLocationCache || {};
        storedCache[username] = obj;
        chrome.storage.local.set({ userLocationCache: storedCache });
        console.log(`[STORAGE SAVE] ${username}: ${location}`);
    });
}

// ======================
// Queue Helpers
// ======================
function enqueueUser(screenName) {
    if (requestQueue.some(item => item.screenName === screenName)) {
        console.log(`[QUEUE] ${screenName} already in queue`);
        return;
    }
    requestQueue.push({ screenName });
    userQueueTimestamp.set(screenName, Date.now());
    console.log(`[QUEUE] Adding ${screenName} to queue`);
}

// ======================
// DOM Helpers
// ======================
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
// API Call Processor
// ======================
async function processApiCall(screenName) {
    return new Promise((resolve) => {
        if (globalRateLimitUntil > Date.now()) {
            console.log(`[GLOBAL PAUSE] Skipping ${screenName}, still in pause`);
            resolve({ username: screenName, location: "Unknown" });
            return;
        }

        chrome.runtime.sendMessage({ type: "get_about_info", screenName }, async (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[MESSAGE ERROR] ${screenName}:`, chrome.runtime.lastError.message);
                resolve({ username: screenName, location: "Unknown" });
                return;
            }

            console.log(`[RAW RESPONSE] ${screenName}:`, response);

            // Rate limit detection
            const rateLimitDetected =
                (typeof response === "string" && response.includes("Rate limit exceeded")) ||
                (response && typeof response.error === "string" && response.error.includes("Rate limit exceeded"));

            if (rateLimitDetected) {
                const idx = userBackoffIndex.get(screenName) || 0;
                const wait = backoffSequence[Math.min(idx, backoffSequence.length - 1)];

                console.warn(`[RATE LIMIT] Hit for ${screenName}. Pausing ${Math.round(wait/1000)}s`);

                userBackoffUntil.set(screenName, Date.now() + wait);
                userBackoffIndex.set(screenName, Math.min(idx + 1, backoffSequence.length - 1));
                globalRateLimitUntil = Math.max(globalRateLimitUntil, Date.now() + 30000);

                // Clear queue except current user
                const cleared = requestQueue.length;
                requestQueue.length = 0;
                console.warn(`[RATE LIMIT] Cleared ${cleared} queued requests`);

                requestQueue.unshift({ screenName });
                resolve({ username: screenName, location: "Unknown" });
                return;
            }

            try {
                const result = response?.data?.data?.user_result_by_screen_name?.result || null;
                const username = result?.core?.screen_name || screenName;
                const location = result?.about_profile?.account_based_in || "Unknown";

                if (isValidLocation(location)) {
                    userLocationCache.set(username, { username, location });
                    saveToStorage(username, location);
                    applyCountryToDOM(username, location);

                    userBackoffIndex.delete(username);
                    userBackoffUntil.delete(username);
                    console.log(`[API SUCCESS] ${username}: ${location}`);
                } else {
                    console.log(`[CACHE SKIP] ${username} - invalid location`);
                }

                resolve({ username, location });
            } catch (err) {
                console.error(`[API PARSE ERROR] ${screenName}:`, err);
                resolve({ username: screenName, location: "Unknown" });
            }
        });
    });
}

// ======================
// Queue Stale Cleaner
// ======================
function cleanStaleRequests() {
    const now = Date.now();
    const originalLength = requestQueue.length;

    for (let i = requestQueue.length - 1; i >= 0; i--) {
        const item = requestQueue[i];
        const queuedTime = userQueueTimestamp.get(item.screenName) || now;
        if (now - queuedTime > QUEUE_STALE_THRESHOLD) {
            console.log(`[QUEUE CLEAN] Removing stale request: ${item.screenName}`);
            requestQueue.splice(i, 1);
            userQueueTimestamp.delete(item.screenName);
        }
    }

    if (requestQueue.length < originalLength) {
        console.log(`[QUEUE CLEAN] Removed ${originalLength - requestQueue.length} stale requests`);
    }
}

// ======================
// Multi-loop Threads
// ======================

// 1️⃣ Storage Checker / Queue Adder
async function storageCheckerLoop() {
    while (true) {
        const els = getAllUsernameElements();
        const usernames = [...new Set([...els].map(el => extractUsername(el)).filter(Boolean))];

        for (const u of usernames) {
            if (userLocationCache.has(u)) {
                applyCountryToDOM(u, userLocationCache.get(u).location);
                continue;
            }

            const stored = await getFromStorage(u);
            if (stored) {
                userLocationCache.set(u, stored);
                applyCountryToDOM(u, stored.location);
                continue;
            }

            if (!seenUsers.has(u)) {
                seenUsers.add(u);
                enqueueUser(u);
            }
        }

        await sleep(1000);
    }
}

// 2️⃣ Queue Processor (API calls)
async function queueProcessorLoop() {
    while (true) {
        cleanStaleRequests();

        if (!requestQueue.length) {
            await sleep(500);
            continue;
        }

        const { screenName } = requestQueue.shift();
        userQueueTimestamp.delete(screenName);
        console.log(`[QUEUE] Processing ${screenName}, queue size: ${requestQueue.length}`);

        await processApiCall(screenName);
        await sleep(7000); // 7s enforced wait between API calls
    }
}

// ======================
// Timeline Observation
// ======================
function observeTimeline() {
    const timeline = document.querySelector("main");
    if (!timeline) return setTimeout(observeTimeline, 1000);

    console.log(`[OBSERVE] Timeline found, observing mutations`);
    const observer = new MutationObserver(() => {});
    observer.observe(timeline, { childList: true, subtree: true });
}

// ======================
// Logging Loop
// ======================
setInterval(() => {
    console.log(`[QUEUE STATUS] ${requestQueue.length} requests pending`);

    const now = Date.now();
    const backoffUsers = [...userBackoffUntil.entries()]
        .filter(([, t]) => t > now)
        .map(([u, t]) => `${u}:${Math.ceil((t-now)/1000)}s`);
    if (backoffUsers.length) console.warn(`[BACKOFF STATE] ${backoffUsers.join(", ")}`);

    if (globalRateLimitUntil > now) {
        console.warn(`[GLOBAL PAUSE] ${Math.ceil((globalRateLimitUntil - now)/1000)}s remaining`);
    }
}, 10000);

// ======================
// Start Loops
// ======================
storageCheckerLoop();
queueProcessorLoop();
observeTimeline();
