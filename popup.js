document.addEventListener("DOMContentLoaded", () => {
    // Re-enable button
    const reEnableBtn = document.getElementById("reEnablePanel");
    if (reEnableBtn) {
        reEnableBtn.addEventListener("click", () => {
            chrome.storage.local.set({ cachePanelEnabled: true }, () => {
                alert("Cache panel will appear again on the timeline!");
            });
        });
    }

    // Toggle panel button
    const toggleBtn = document.getElementById("toggle-panel-btn");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            chrome.storage.local.get(["cachePanelEnabled"], (result) => {
                const newState = !result.cachePanelEnabled;
                chrome.storage.local.set({ cachePanelEnabled: newState }, () => {
                    alert(`Cache panel is now ${newState ? "enabled" : "hidden"}`);
                });
            });
        });
    }

    // Update stats function
    function updatePopupStatus() {
        // Storage
        chrome.storage.local.getBytesInUse(["userLocationCache"], (bytes) => {
            const el = document.getElementById("storage-status");
            if (el) el.textContent = `Storage: ${bytes} bytes`;
        });

        // Memory cache, queue, backoff (via scripting)
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (!tabs[0]?.id) return;
            const tabId = tabs[0].id;

            // Memory
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    return window.userLocationCache?.size || 0;
                }
            }, (results) => {
                const memEl = document.getElementById("memory-status");
                if (memEl) memEl.textContent = `Memory: ${results?.[0]?.result || 0} entries`;
            });

            // Queue and backoff
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const queueLen = window.requestQueue?.length || 0;
                    const now = Date.now();
                    const backoffUsers = [...(window.userBackoffUntil?.entries()||[])]
                        .filter(([_, t]) => t > now)
                        .map(([u, t]) => `${u}:${Math.ceil((t - now)/1000)}s`);
                    return { queueLen, backoffUsers };
                }
            }, (results) => {
                const res = results?.[0]?.result || {};
                const queueEl = document.getElementById("queue-status");
                const backoffEl = document.getElementById("backoff-status");
                if (queueEl) queueEl.textContent = `Queue: ${res.queueLen || 0}`;
                if (backoffEl) backoffEl.textContent = `Backoff: ${res.backoffUsers?.join(", ") || "None"}`;
            });
        });
    }

    updatePopupStatus();
    setInterval(updatePopupStatus, 2000);
});
