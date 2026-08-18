# Privacy Policy

**Last Updated: August 18, 2026**

This Privacy Policy applies to **SyncNos WebClipper** (the “Extension”), a browser extension for Chrome/Chromium, Firefox, and Safari.

## 1. Single Purpose

The Extension’s single purpose is to help you save **visible** AI conversations, web articles, and already-loaded video transcripts locally, manage local article comments, export them, and optionally sync derived copies to external destinations that you configure.

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

- By default, conversation facts are stored locally in the browser profile using IndexedDB.
- On supported desktop browsers, Local Database is opt-in. After explicit confirmation, the conversation fact set may be migrated to the fixed per-user SyncNos SQLite database through the locally installed SyncNos CLI / Native Host. The database is not activated merely because a SQLite file already exists.
- Browser-profile migration state, settings, OAuth state, and other small configuration remain local browser state, primarily in `chrome.storage.local`.
- Small UI state (e.g., in-page button position) may be stored using `localStorage`.
- Backup/export packages are created locally; they may include conversations, messages, comments, mappings, cached images, and non-sensitive settings, while sensitive OAuth credentials are excluded.

## 4. External Sync (Optional)

If you configure Notion, Obsidian, or Feishu/Lark sync, SyncNos sends only the content needed for that configured destination when a sync job runs. External destinations receive derived copies and never become the authority for local conversation facts.

- Notion sync uses the Notion API over HTTPS and may upload referenced images when supported.
- Obsidian sync writes to the Local REST API endpoint that you configure on your device.
- Feishu/Lark sync uses Feishu/Lark APIs after OAuth authorization.
- Synced article output may include local comment-thread content and related metadata when that feature is used.

Each destination handles received data under its own privacy policy or local configuration.

## 5. OAuth / Token Exchange Proxies

For provider modes that require a client secret that should not be embedded in a public extension, SyncNos may use a small configured server/Worker endpoint for OAuth code exchange. The official Notion flow and the official Feishu/Lark application mode use their corresponding configured exchange service; a user-managed Feishu/Lark application may instead keep its own secret in local extension storage.

- An exchange endpoint receives the OAuth material required for that provider flow and returns the token response to the Extension.
- Exchange services are not intended to receive or store your saved conversation/article content.
- User-managed provider secrets remain local and are excluded from SyncNos backups.

## 6. Permissions and Why They Are Needed

- `storage`: store settings and small state locally (e.g., Notion connection status, selected parent page ID).
- `contextMenus`: provide right-click menu actions (e.g., capture/save/export/sync entry points).
- `tabs`: open/focus the extension app page, open authorization/help links, and improve UX during OAuth flows.
- `tabGroups`: keep Chat with AI result tabs organized when the browser supports tab grouping.
- `webNavigation`: detect OAuth redirect/callback navigation to complete connection flows.
- `scripting`: inject packaged scripts into the current page to enable capture and in-page UI.
- `alarms`: schedule local maintenance and configured background jobs.
- `nativeMessaging` (supported desktop browser builds only): connect on demand to the locally installed SyncNos Native Host when Local Database is explicitly used. The Host is not a remote service and exits when its browser connection ends.
- `declarativeNetRequestWithHostAccess` or `declarativeNetRequest`, depending on the browser: temporarily adjust request headers for anti-hotlink image downloads.
- Host permissions: allow capture on supported sites and arbitrary web pages, reach configured sync/OAuth endpoints, and access image/CDN resources needed by enabled features.

## 7. Remote Code

The Extension does **not** download or execute remote code. All executable code is packaged with the Extension; network requests are used only to exchange data (e.g., Notion OAuth and Notion API) when you choose to connect or sync.

## 8. Data Sharing

We do not sell your data. Data is only sent to third parties when you use those features, such as:

- Notion (when you configure/use Notion sync)
- Feishu/Lark (when you configure/use Feishu/Lark sync)
- The configured OAuth token exchange proxy endpoint (only for the corresponding OAuth exchange)
- Obsidian Local REST API (on your device, when you configure/use Obsidian sync)

## 9. Contact

If you have questions about this Privacy Policy:

- GitHub Issues: https://github.com/chiimagnus/SyncNos/issues
