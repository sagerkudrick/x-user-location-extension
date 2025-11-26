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

let isRateLimited = false;
let rateLimitStart = 0;
let rateLimitDuration = 5000; // default wait for 5s on rate limit

function fetchAccountLocation(screenName) {
    if (userLocationCache.has(screenName)) {
        console.log(`[CACHE HIT] ${screenName}`);
        return Promise.resolve(userLocationCache.get(screenName));
    }

    console.log(`[QUEUE] Adding ${screenName} to queue`);
    return new Promise(resolve => requestQueue.push({ screenName, resolve }));
}

// ======================
// Queue Processor
// ======================
setInterval(() => {
    if (isRateLimited || requestQueue.length === 0) return;

    const { screenName, resolve } = requestQueue.shift();
    console.log(`[QUEUE] Processing ${screenName}, queue size: ${requestQueue.length}`);

    if (userLocationCache.has(screenName)) {
        resolve(userLocationCache.get(screenName));
        return;
    }

    try {
 chrome.runtime.sendMessage({ type: "get_about_info", screenName }, (response) => {
    if (chrome.runtime.lastError) {
        console.error(`[MESSAGE ERROR] ${screenName}:`, chrome.runtime.lastError.message);
        resolve({ username: screenName, location: "Unknown" });
        return;
    }

    console.log(`[RAW RESPONSE] ${screenName}:`, response); // <--- print full raw response

    try {
        if (typeof response === "string" && response.includes("Rate limit exceeded")) {
            isRateLimited = true;
            rateLimitStart = Date.now();
            console.warn(`[RATE LIMIT] Hit for ${screenName}. Waiting ${rateLimitDuration}ms before retry`);

            setTimeout(() => {
                isRateLimited = false;
                const waited = Date.now() - rateLimitStart;
                console.log(`[RATE LIMIT] Waited ${waited}ms, retrying ${screenName} now`);
                requestQueue.unshift({ screenName, resolve }); // retry this user first
            }, rateLimitDuration);

            return;
        }

        const result = response.data?.data?.user_result_by_screen_name?.result || null;
        const username = result?.core?.screen_name || screenName;
        const location = result?.about_profile?.account_based_in || "Unknown";
        const data = { username, location };

        console.log(`[API SUCCESS] ${username}: ${location}`);
        console.log(`[PARSED DATA]`, data); // <--- print parsed data object

        userLocationCache.set(username, data);
        applyCountryToDOM(username, location);
        resolve(data);

            } catch (err) {
                console.error(`[API PARSE ERROR] ${screenName}:`, err);
                resolve({ username: screenName, location: "Unknown" });
            }
        });
    } catch (err) {
        console.error(`[SEND MESSAGE EXCEPTION] ${screenName}:`, err);
        resolve({ username: screenName, location: "Unknown" });
    }
}, 1500);

// Print rate limit status every 10 seconds
setInterval(() => {
    if (isRateLimited) {
        const waited = Date.now() - rateLimitStart;
        const remaining = Math.max(0, rateLimitDuration - waited);
        console.warn(`[RATE LIMIT] Waiting... waited ${waited}ms, retry in ${remaining}ms`);
    }
}, 10000);

// ======================
// DOM Helpers
// ======================
function getAllUsernameElements() {
    return document.querySelectorAll("a[href^='/'] span span");
}

function applyCountryToDOM(username, location) {
    const userElements = document.querySelectorAll(`a[href='/${username}'] span span`);
    if (!userElements.length) return;

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

function observeTimeline() {
    const timeline = document.querySelector("main");
    if (!timeline) {
        console.log(`[OBSERVE] Timeline not found, retrying...`);
        return setTimeout(observeTimeline, 1000);
    }

    console.log(`[OBSERVE] Timeline found, observing mutations`);
    const observer = new MutationObserver(updateVisibleUsers);
    observer.observe(timeline, { childList: true, subtree: true });

    updateVisibleUsers(); // initial pass
}

observeTimeline();
