// ======================
// Country / Flag Helpers
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
};

function countryCodeToFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🏳️";
    const codePoints = [...countryCode.toUpperCase()]
        .map(c => 0x1F1E6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(...codePoints);
}

function getFlagFromLocation(location) {
    if (!location) return "🏳️";
    for (const [name, code] of Object.entries(countryNameToCode)) {
        if (location.toLowerCase().includes(name.toLowerCase())) {
            return countryCodeToFlagEmoji(code);
        }
    }
    return location;
}

// ======================
// API + Queue + Caching
// ======================
const userLocationCache = new Map();
const requestQueue = [];
let requestsInWindow = 0;

const MAX_REQUESTS = 900;       // per window
const WINDOW_MS = 2 * 60 * 1000; // 2 minutes

setInterval(() => { 
    requestsInWindow = 0; 
    processQueue(); 
}, WINDOW_MS);

function fetchAccountLocation(screenName) {
    if (userLocationCache.has(screenName)) {
        // Already cached, just return
        return Promise.resolve(userLocationCache.get(screenName));
    }

    return new Promise(resolve => {
        requestQueue.push({ screenName, resolve });
        processQueue();
    });
}

function processQueue() {
    while (requestQueue.length > 0 && requestsInWindow < MAX_REQUESTS) {
        const { screenName, resolve } = requestQueue.shift();
        requestsInWindow++;

        chrome.runtime.sendMessage(
            { type: "get_about_info", screenName },
            (response) => {
                let data;
                if (response.error) {
                    console.error("API Error:", response.error);
                    data = { username: screenName, location: "Unknown" };
                } else {
                    const result = response.data?.data?.user_result_by_screen_name?.result || null;
                    const username = result?.core?.screen_name || screenName;
                    const location = result?.about_profile?.account_based_in || "Unknown";
                    data = { username, location };
                }

                userLocationCache.set(screenName, data);
                applyFlagToDOM(username, data.location);
                resolve(data);
            }
        );
    }
}

// ======================
// DOM Helpers
// ======================
function getAllUsernameElements() {
    return document.querySelectorAll("a[href*='/'] span span");
}

function applyFlagToDOM(username, location) {
    const userElements = document.querySelectorAll(`a[href='/${username}'] span span`);
    userElements.forEach(el => {
        const flag = getFlagFromLocation(location);
        el.textContent = `${flag} | ${username}`;
    });
}

// ======================
// Timeline Observation
// ======================
const seenUsers = new Set();

function updateVisibleUsers() {
    const els = getAllUsernameElements();
    const usernames = [...new Set([...els].map(el => {
        const parent = el.closest("a[href*='/']");
        if (!parent) return null;
        const href = parent.getAttribute("href");
        if (!href) return null;
        const match = href.match(/^\/([^\/]+)$/);
        return match ? match[1] : null;
    }).filter(Boolean))];

    usernames.forEach(u => {
        if (userLocationCache.has(u)) {
            applyFlagToDOM(u, userLocationCache.get(u).location);
        } else if (!seenUsers.has(u)) {
            seenUsers.add(u);
            fetchAccountLocation(u);
        }
    });
}

function observeTimeline() {
    const timeline = document.querySelector("main");
    if (!timeline) {
        return setTimeout(observeTimeline, 1000);
    }

    // Observe DOM mutations
    const observer = new MutationObserver(updateVisibleUsers);
    observer.observe(timeline, { childList: true, subtree: true });

    // Also run immediately for initial content
    updateVisibleUsers();
}

observeTimeline();
