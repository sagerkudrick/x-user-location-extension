// Function to dynamically get cookies for x.com
async function getCookies(url) {
    return new Promise(resolve => {
        chrome.cookies.getAll({ url }, (cookies) => {
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
            const ct0Cookie = cookies.find(c => c.name === "ct0")?.value || "";
            resolve({ cookieString, ct0Cookie });
        });
    });
}

// Function to dynamically fetch the Bearer token from the page
async function getBearerToken() {
    // Many frontend scripts use a public Bearer token stored in window.__INITIAL_STATE__ or inline JS
    // For simplicity, we'll return the default public Bearer token (still works for public GraphQL queries)
    return "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
}

// Main function to fetch About info
async function fetchAboutInfo(screenName) {
    const { cookieString, ct0Cookie } = await getCookies("https://x.com");
    const bearer = await getBearerToken();

    const variables = encodeURIComponent(JSON.stringify({ screenName }));
    const url = `https://x.com/i/api/graphql/zs_jFPFT78rBpXv9Z3U2YQ/AboutAccountQuery?variables=${variables}`;

    const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
            "Authorization": bearer,
            "x-csrf-token": ct0Cookie,
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
            "Cookie": cookieString // include all cookies dynamically
        }
    });

    return await res.json();
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "get_about_info") {
        fetchAboutInfo(msg.screenName)
            .then(data => sendResponse({ data }))
            .catch(err => sendResponse({ error: err.toString() }));
        return true; // keep async response alive
    }
});
