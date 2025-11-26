# Chrome Flag — Country Badge Extension (WIP)

⚠️  DO NOT USE AS-IS - This project utilizes x.com's API that has strict API limits. Repeated calls (which are made as you scroll through twitter, to parse users locations) will quickly rate limit your account.  ⚠️



This is a small Chrome extension that displays a person's country next to their name on supported pages.

Files in this repository
- `background.js`
- `content.js`
- `manifest.json`
- `styles.css`

**Status:** Work in progress — the extension currently uses x.com's API to resolve country information and can be rate-limited. See "Rate limits & mitigation" below.

**Purpose & features**
- **Purpose:** Enhance UI by showing a country label next to a person's name.
- **Files:** `content.js` handle DOM detection and insertion; `background.js` may be used for API calls or central orchestration.
- **Small footprint:** Lightweight CSS in `styles.css` for the flag/badge appearance.

Installation (load unpacked)
- Open `chrome://extensions/` in Chrome.
- Enable **Developer mode** (top-right).
- Click **Load unpacked** and select the project folder (`chrome-flag`).

Usage
- Visiting x.com will result in users locations being parsed from their x.com/{username}/about and appended to their name.

Rate limits & mitigation (current limitation)
- **Current problem:** The extension resolves country info via x.com's API. If the API enforces a request quota or per-IP rate limit, making many requests (e.g., for many names or on repeated page updates) will hit limits and cause errors or blocked requests.

Suggested improvements to avoid rate limiting
- **Cache results locally:** Store resolved country codes in `chrome.storage.local`. This prevents repeated requests for the same person.
- **Use a server-side proxy:** Route requests through a small backend that holds the API key, implements caching, and throttles requests. This centralizes usage and avoids client-side quota exhaustion.
- **Exponential backoff & retry:** When requests are throttled, back off and retry with increasing delays.

Developer notes
- Use `console.log`/DevTools to inspect what elements the extension detects.
- Helpful improvements to implement next:
  - Caching layer in `background.js` using `chrome.storage.local`.
  - Debounced MutationObserver in `content.js` so lookups don't run repeatedly.
  - Configurable endpoint or API key stored in extension options (so users can supply their own key).
  - Add status indicators for failed lookups and graceful fallbacks.

Troubleshooting
- If badges don't show up: check `manifest.json` permissions and host permissions for the API endpoint.
- If you see 429 or other rate-limit responses: reduce lookup frequency or implement caching/proxy.

Contributing
- Open issues or PRs for fixes and improvements.
- If implementing heavy network logic, include tests for caching and throttling.

License
- No license file included. Add a `LICENSE` if you want to specify terms.
