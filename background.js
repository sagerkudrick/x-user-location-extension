// ======================
// Cookie & Bearer Helpers
// ======================
async function getCookies(url) {
    return new Promise(resolve => {
        chrome.cookies.getAll({ url }, (cookies) => {
            if (!cookies || !cookies.length) {
                console.warn("[BG] No cookies found for", url);
            }

            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
            const ct0Cookie = cookies.find(c => c.name === "ct0")?.value || "";

            if (!ct0Cookie) console.warn("[BG] ct0 cookie not found!");

            console.log("[BG] Retrieved cookies:", cookies);
            console.log("[BG] Cookie string:", cookieString);
            console.log("[BG] ct0 cookie:", ct0Cookie);

            resolve({ cookieString, ct0Cookie });
        });
    });
}

async function getBearerToken() {
    // Default public bearer token (works for public queries)
    const token = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
    console.log("[BG] Using Bearer token:", token);
    return token;
}

// ======================
// Fetch About Info
// ======================
async function fetchAboutInfo(screenName) {
    console.log(`[BG] Fetching about info for: ${screenName}`);

    const { cookieString, ct0Cookie } = await getCookies("https://x.com");
    const bearer = await getBearerToken();

    if (!ct0Cookie) {
        console.warn(`[BG] Cannot fetch info for ${screenName}: ct0 missing`);
        return { error: "Missing CSRF cookie" };
    }

    const variables = encodeURIComponent(JSON.stringify({ screenName }));
    const url = `https://x.com/i/api/graphql/zs_jFPFT78rBpXv9Z3U2YQ/AboutAccountQuery?variables=${variables}`;

    console.log("[BG] Request URL:", url);
    console.log("[BG] Request headers:", {
        Authorization: bearer,
        "x-csrf-token": ct0Cookie,
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        Cookie: cookieString
    });

    try {
        const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: {
                "Authorization": bearer,
                "x-csrf-token": ct0Cookie,   // MUST match ct0 cookie
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
                "Cookie": cookieString
            }
        });

        const data = await res.json();
        console.log(`[BG] API response for ${screenName}:`, data);

        if (data?.errors?.some(e => e.message.includes("csrf"))) {
            console.warn(`[BG] CSRF mismatch detected for ${screenName}`);
        }

        return data;
    } catch (err) {
        console.error(`[BG] Fetch error for ${screenName}:`, err);
        return { error: err.toString() };
    }
}

// ======================
// Message Listener
// ======================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "get_about_info") {
        console.log(`[BG] Message received for: ${msg.screenName}`);
        fetchAboutInfo(msg.screenName)
            .then(data => sendResponse({ data }))
            .catch(err => sendResponse({ error: err.toString() }));
        return true; // keep async response alive
    }
});
