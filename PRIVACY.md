# Privacy Policy

**Last Updated: February 22, 2026**

This Privacy Policy applies to **SyncNos WebClipper** (the “Extension”), a browser extension for Chrome/Chromium and Firefox.

## 1. Single Purpose

The Extension’s single purpose is to help you save **visible** conversations from supported websites to your browser locally, export them, and (optionally) sync them to Notion **when you manually trigger a sync**.

## 2. What Data the Extension Accesses

When you visit a supported site, the Extension may read content from the current page **that is visible to you**, such as:

- Conversation text (user/assistant messages)
- Page metadata needed to organize saves (e.g., title and URL)
- Image URLs embedded in the conversation (for preview/export and optional Notion sync)

The Extension may automatically capture updates while you stay on a supported conversation page, and it also provides an in-page “Save” button for manual capture.

## 3. Local Storage

The Extension is local-first:

- Saved conversations and messages are stored locally in your browser using IndexedDB.
- Settings and small state (e.g., Notion connection status, selected parent page ID) are stored locally using `chrome.storage.local`.
- Small UI state (e.g., in-page button position) may be stored using `localStorage`.

## 4. Notion Sync (Optional, Manual)

If you choose to connect Notion and manually trigger sync:

- The Extension sends data to Notion over HTTPS using the Notion API.
- The Extension may download referenced images (by URL) and upload them to Notion as file uploads if supported by Notion.

Notion’s handling of data is governed by Notion’s own privacy policy.

## 5. OAuth / Token Exchange Proxy

To avoid embedding a Notion OAuth client secret in the Extension, the Extension uses a small server endpoint to exchange the OAuth authorization code for a token:

- The endpoint receives an authorization code and redirect URI and returns the token response to the Extension.
- The endpoint applies best-effort rate limiting and is not intended to store your conversation content.

## 6. Permissions and Why They Are Needed

- `storage`: store your saved conversations, settings, and Notion connection state locally.
- `downloads`: export your data to local files upon your request.
- `tabs`: open authorization/help links and improve UX during OAuth flows.
- `webNavigation`: detect the OAuth redirect/callback navigation to complete the connection flow.
- Host permissions: run only on supported sites you choose to use and access Notion endpoints required for sync.

## 7. Remote Code

The Extension does **not** download or execute remote code. All executable code is packaged with the Extension; network requests are used only to exchange data (e.g., Notion OAuth and Notion API) when you choose to connect or sync.

## 8. Data Sharing

We do not sell your data. Data is only sent to third parties when you use those features, such as:

- Notion (when you connect/sync)
- The token exchange proxy endpoint (only for OAuth token exchange)

## 9. Contact

If you have questions about this Privacy Policy:

- GitHub Issues: https://github.com/chiimagnus/SyncNos/issues