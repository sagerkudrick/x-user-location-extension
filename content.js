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

function editUsernameDOM(username, location) {
    const userElements = document.querySelectorAll("a[href='/" + username + "'] span span");
    userElements.forEach(el => {
        const flag = getFlagFromLocation(location); // or pass fetched location
        el.textContent = `${flag} | ${username}`;
    });
}

function fetchAccountLocation(_screenName) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: "get_about_info", screenName: _screenName },
            (response) => {
                if (response.error) {
                    console.error("API Error:", response.error);
                    resolve({ username: _screenName, location: "Unknown" });
                    return;
                }

                const result = response.data?.data?.user_result_by_screen_name?.result || null;
                if (!result) {
                    console.log("No user info found in API response for", _screenName);
                    resolve({ username: _screenName, location: "Unknown" });
                    return;
                }

                const username = result.core?.screen_name || _screenName;
                const location = result.about_profile?.account_based_in || "Unknown";

                // Update DOM immediately
                editUsernameDOM(username, location);

                resolve({ username, location });
            }
        );
    });
}


// Scrape timeline usernames
function getUsernamesFromTimeline() {
    const els = document.querySelectorAll("a[href*='/'] span span");
    const users = [];

    els.forEach(el => {
        const parent = el.closest("a[href*='/']");
        if (!parent) return;

        const href = parent.getAttribute("href");
        if (!href) return;

        const match = href.match(/^\/([^\/]+)$/);
        if (match) users.push(match[1]);
    });

    return [...new Set(users)];
}

// Observe timeline
function observeTimeline() {
    console.log("[content] Observing timeline...");

    const timeline = document.querySelector("main");
    if (!timeline) {
        console.log("[content] Timeline not ready, retrying...");
        return setTimeout(observeTimeline, 1000);
    }

    console.log("[content] Timeline found.");

    const seen = new Set();

    async function handle() {
        const users = getUsernamesFromTimeline();
        for (const u of users) {
            if (!seen.has(u)) {
                seen.add(u);
                console.log("[content] New user detected:", u);

                const loc = await fetchAccountLocation(u);
                console.log("[content] Location for", u, "=", loc);
            }
        }
    }

    async function handle() {
        const users = getUsernamesFromTimeline();
        for (const u of users) {
            if (!seen.has(u)) {
                seen.add(u);
                console.log("[content] New user detected:", u);

                const { location } = await fetchAccountLocation(u);
                console.log("[content] Location for", u, "=", location);
            }
        }
    }


    const obs = new MutationObserver(handle);
    obs.observe(timeline, { childList: true, subtree: true });

    console.log("[content] Timeline observer active");
}

observeTimeline();