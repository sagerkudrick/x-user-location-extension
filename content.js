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
const requestQueue = [];
const seenUsers = new Set();

function fetchAccountLocation(screenName) {
    if (userLocationCache.has(screenName)) {
        console.log(`[CACHE HIT] ${screenName}`);
        return Promise.resolve(userLocationCache.get(screenName));
    }

    console.log(`[QUEUE] Adding ${screenName} to queue`);
    return new Promise(resolve => {
        requestQueue.push({ screenName, resolve });
    });
}

// Process queue every 1.5 seconds
setInterval(() => {
    if (!requestQueue.length) return;

    const { screenName, resolve } = requestQueue.shift();
    console.log(`[QUEUE] Processing ${screenName}, queue size: ${requestQueue.length}`);

    if (userLocationCache.has(screenName)) {
        console.log(`[CACHE HIT in queue] ${screenName}`);
        resolve(userLocationCache.get(screenName));
        return;
    }

    try {
        chrome.runtime.sendMessage(
            { type: "get_about_info", screenName },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`[MESSAGE ERROR] ${screenName}:`, chrome.runtime.lastError.message);
                    resolve({ username: screenName, location: "Unknown" });
                    return;
                }

                let data;
                if (response?.error) {
                    console.error(`[API ERROR] ${screenName}:`, response.error);
                    data = { username: screenName, location: "Unknown" };
                } else {
                    const result = response.data?.data?.user_result_by_screen_name?.result || null;
                    const username = result?.core?.screen_name || screenName;
                    const location = result?.about_profile?.account_based_in || "Unknown";
                    data = { username, location };
                    console.log(`[API SUCCESS] ${username}: ${location}`);
                }

                userLocationCache.set(screenName, data);
                applyCountryToDOM(data.username, data.location);
                resolve(data);
            }
        );
    } catch (err) {
        console.error(`[SEND MESSAGE EXCEPTION] ${screenName}:`, err);
        resolve({ username: screenName, location: "Unknown" });
    }
}, 1500);

// ======================
// DOM Helpers
// ======================
function getAllUsernameElements() {
    return document.querySelectorAll("a[href^='/'] span span");
}

function applyCountryToDOM(username, location) {
    const userElements = document.querySelectorAll(`a[href='/${username}'] span span`);
    if (!userElements.length) {
        console.log(`[DOM] No elements found for ${username}`);
        return;
    }

    const countryText = getCountryFromLocation(location);
    userElements.forEach(el => {
        if (!el.dataset.countryApplied) {
            el.textContent = `${countryText} | ${username}`;
            el.dataset.countryApplied = "true"; // prevent reapplying
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

    console.log(`[UPDATE] Found usernames:`, usernames);

    usernames.forEach(u => {
        if (userLocationCache.has(u)) {
            console.log(`[DOM] Updating cached ${u}`);
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
