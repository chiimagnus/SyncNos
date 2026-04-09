# Privacy Policy

**Last Updated: April 9, 2026**

This Privacy Policy applies to **SyncNos WebClipper** (the “Extension”), a browser extension for Chrome/Chromium and Firefox.

## 1. Single Purpose

The Extension’s single purpose is to help you save **visible** AI conversations (and optionally web articles) from pages you view to your browser locally, manage local article comments, export them, and (optionally) sync them to external destinations (e.g., Notion / Obsidian) **when you manually trigger a sync**.

## 2. What Data the Extension Accesses

When you visit a supported site, the Extension may read content from the current page **that is visible to you**, such as:

- Conversation text (user/assistant messages)
- Page metadata needed to organize saves (e.g., title and URL)
- Image URLs embedded in the conversation (for preview/export and optional Notion sync)

When you manually save a web page as an article, the Extension may read the article content from the current page to extract a readable version (title/body) for local storage and export.

If you use article comments or in-page comments, the Extension may also read and write the local comment thread content, quoted text, and locator metadata that you enter in the Extension UI.

For supported conversations and articles, the Extension may also read embedded image URLs so it can preview, export, or cache images locally when you enable image-related features.

The Extension may automatically capture updates while you stay on a supported conversation page, and it also provides an in-page “Save” button for manual capture.

## 3. Local Storage

The Extension is local-first:

- Saved conversations and messages are stored locally in your browser using IndexedDB.
- Article comments, sync mappings, and other local thread metadata are stored locally as part of the Extension’s own data model.
- Settings and small state (e.g., Notion connection status, selected parent page ID) are stored locally using `chrome.storage.local`.
- Small UI state (e.g., in-page button position) may be stored using `localStorage`.
- Backup/export packages are created locally; they may include conversations, messages, comments, and settings, while sensitive OAuth tokens are excluded.

## 4. Notion Sync (Optional, Manual)

If you choose to connect Notion and manually trigger sync:

- The Extension sends data to Notion over HTTPS using the Notion API.
- If you sync an article that has local comments, the Extension may include the related comment thread content and comment-count metadata in the synced output.
- The Extension may download referenced images (by URL) and upload them to Notion as file uploads if supported by Notion.

Notion’s handling of data is governed by Notion’s own privacy policy.

## 5. OAuth / Token Exchange Proxy

To avoid embedding a Notion OAuth client secret in the Extension, the Extension uses a small server endpoint to exchange the OAuth authorization code for a token:

- The endpoint receives an authorization code and redirect URI and returns the token response to the Extension.
- The endpoint applies best-effort rate limiting and is not intended to store your conversation content.

## 6. Permissions and Why They Are Needed

- `storage`: store settings and small state locally (e.g., Notion connection status, selected parent page ID).
- `contextMenus`: provide right-click menu actions (e.g., capture/save/export/sync entry points).
- `tabs`: open/focus the extension app page, open authorization/help links, and improve UX during OAuth flows.
- `tabGroups`: keep Chat with AI result tabs organized when the browser supports tab grouping.
- `webNavigation`: detect the OAuth redirect/callback navigation to complete the connection flow.
- `activeTab`: access the current tab when you interact with the Extension (e.g., manual capture) without needing persistent access.
- `scripting`: inject packaged scripts into the current page to enable capture and in-page UI.
- `declarativeNetRequestWithHostAccess`: temporarily adjust request headers for anti-hotlink image downloads on supported browsers.
- Host permissions: allow the Extension to run on supported AI chat sites and arbitrary web pages for manual article capture, to access Notion endpoints and the OAuth worker required for sync, and to reach CDN hosts used by anti-hotlink image caching.

## 7. Remote Code

The Extension does **not** download or execute remote code. All executable code is packaged with the Extension; network requests are used only to exchange data (e.g., Notion OAuth and Notion API) when you choose to connect or sync.

## 8. Data Sharing

We do not sell your data. Data is only sent to third parties when you use those features, such as:

- Notion (when you connect/sync)
- The token exchange proxy endpoint (only for OAuth token exchange)
- Obsidian Local REST API (on your device, when you configure/sync to Obsidian)

## 9. Contact

If you have questions about this Privacy Policy:

- GitHub Issues: https://github.com/chiimagnus/SyncNos/issues