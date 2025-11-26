// Read storage and memory caches
function updatePopupStatus() {
    chrome.storage.local.getBytesInUse(["userLocationCache"], (bytes) => {
        document.getElementById("storage-status").textContent = `Storage: ${bytes} bytes`;
    });

    // Memory cache size
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const tabId = tabs[0].id;
        chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const memSize = window.userLocationCache ? window.userLocationCache.size : 0;
                return memSize;
            }
        }, (results) => {
            const memSize = results?.[0]?.result || 0;
            document.getElementById("memory-status").textContent = `Memory: ${memSize} entries`;
        });
    });

    // Queue and backoff
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const tabId = tabs[0].id;
        chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const queueLen = window.requestQueue?.length || 0;
                const now = Date.now();
                const backoffUsers = [...(window.userBackoffUntil?.entries()||[])].filter(([_, t])=> t>now)
                                    .map(([u, t])=> `${u}:${Math.ceil((t-now)/1000)}s`);
                return { queueLen, backoffUsers };
            }
        }, (results) => {
            const { queueLen, backoffUsers } = results?.[0]?.result || {};
            document.getElementById("queue-status").textContent = `Queue: ${queueLen || 0}`;
            document.getElementById("backoff-status").textContent = `Backoff: ${backoffUsers?.join(", ") || "None"}`;
        });
    });
}

// Toggle the panel visibility on the page
document.getElementById("toggle-panel-btn").addEventListener("click", () => {
    chrome.storage.local.get(["cachePanelEnabled"], (result) => {
        const newState = !result.cachePanelEnabled;
        chrome.storage.local.set({ cachePanelEnabled: newState }, () => {
            alert(`Cache panel is now ${newState ? "enabled" : "hidden"}`);
        });
    });
});

// Update stats every 2s
updatePopupStatus();
setInterval(updatePopupStatus, 2000);
