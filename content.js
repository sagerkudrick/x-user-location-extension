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
// API + Queue + Caching
// ======================
const userLocationCache = new Map();
let requestQueue = [];
const seenUsers = new Set();
let isProcessingQueue = false;
let savedQueue = []; // to restore after rate limit

function enqueueUser(screenName) {
    if (!seenUsers.has(screenName)) {
        seenUsers.add(screenName);
        requestQueue.push(screenName);
        savedQueue.push(screenName); // keep a backup
    }
    processQueue();
}

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (requestQueue.length > 0) {
        const screenName = requestQueue.shift();

        // skip if cached
        if (userLocationCache.has(screenName)) continue;

        try {
            const data = await fetchAboutInfo(screenName);
            userLocationCache.set(screenName, data);
            applyCountryToDOM(data.username, data.location);
        } catch (err) {
            console.error(`[QUEUE ERROR] ${screenName}:`, err);
        }

        // wait 2.5 seconds between requests
        await delay(2500);
    }

    isProcessingQueue = false;
}

async function fetchAboutInfo(screenName) {
    const url = `https://x.com/${screenName}/about`;

    while (true) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': 'Bearer YOUR_BEARER_TOKEN_HERE',
                    'x-csrf-token': getCt0Cookie(),
                    'Content-Type': 'application/json'
                }
            });

            const text = await response.text();

            // rate limit detected
            if (text.includes("Rate limit exceeded")) {
                console.warn(`[API] Rate limit hit! Pausing queue for 5 minutes...`);

                // clear current queue
                requestQueue = [];

                // wait 5 minutes
                await delay(5 * 60 * 1000);

                // restore saved queue and retry
                requestQueue = [...savedQueue];
                continue;
            }

            const json = JSON.parse(text);
            const result = json.data?.data?.user_result_by_screen_name?.result || null;
            const username = result?.core?.screen_name || screenName;
            const location = result?.about_profile?.account_based_in || "Unknown";

            console.log(`[API SUCCESS] ${username}: ${location}`);
            return { username, location };

        } catch (err) {
            console.error(`[API ERROR] ${screenName}:`, err);
            // wait a bit before retrying
            await delay(5000);
        }
    }
}

// Helper: get ct0 cookie
function getCt0Cookie() {
    const match = document.cookie.match(/ct0=([^;]+)/);
    return match ? match[1] : '';
}

// Simple delay function
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
        } else {
            enqueueUser(u);
        }
    });
}

function observeTimeline() {
    const timeline = document.querySelector("main");
    if (!timeline) return setTimeout(observeTimeline, 1000);

    const observer = new MutationObserver(updateVisibleUsers);
    observer.observe(timeline, { childList: true, subtree: true });

    updateVisibleUsers();
}

observeTimeline();
