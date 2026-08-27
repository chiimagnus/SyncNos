# Privacy Policy

**Last Updated: 2026-08-27**

This Privacy Policy applies to SyncNos WebClipper (the “Extension”), including its supported Chromium, Firefox-family, and Safari builds.

## 1. Purpose

The Extension helps you capture supported AI conversations, web articles, and already-loaded video transcripts; manage local article comments and cached images; export local data; and optionally sync local content to external destinations that you configure.

SyncNos is local-first. A successful local save is the primary record; external sync targets and exported files are derived copies.

## 2. Page Data the Extension May Read

Depending on the feature you invoke or enable, the Extension may read data that is available in pages you visit, including:

- AI conversation messages and related page metadata;
- article text, title, URL, author, publish date, and site-specific metadata;
- video transcripts/subtitles that the page has already loaded;
- image URLs embedded in captured content;
- text selections and locator metadata used for local article comments.

Supported non-virtualized AI sites can be captured automatically when AI auto-save is enabled. ChatGPT and Google AI Studio require explicit manual capture because their virtualized lists cannot be treated as complete automatically. Article capture is manually initiated.

## 3. Local Storage and Backups

The Extension stores durable captured content in browser IndexedDB. Browser extension local storage is used for settings, connection state, OAuth credentials, sync configuration, queues/jobs, and other small state. UI-only state may also use local or session storage.

Backup/export packages are assembled locally. They may include captured content, sync mappings, cached images, article comments, and non-sensitive settings. Backup filtering excludes authentication secrets including Notion and Feishu OAuth tokens, Notion and Feishu client secrets, the Obsidian Local REST API key, and GitHub Device Flow/auth state containing access tokens, refresh tokens, or pending device credentials.

For the current storage and recovery contract, see [docs/storage.md](docs/storage.md).

## 4. External Sync and Network Requests

External sync is optional. Connected providers can be synchronized manually, and each provider also has an optional auto-sync setting. When auto-sync is enabled, local content changes can be queued and sent to that provider without another manual sync click.

### Notion

Notion sync sends selected local content to the Notion API over HTTPS. The Extension may also fetch referenced images and upload them to Notion when the relevant image feature is used.

Notion OAuth uses a token-exchange proxy so the Extension does not embed the official Notion client secret. The proxy receives the OAuth authorization code and redirect URI needed for token exchange; it is not used to receive captured conversation/article/video content.

### Feishu (Lark)

Feishu sync sends selected local content to Feishu APIs over HTTPS.

Feishu OAuth supports two modes:

- **Proxy mode:** the configured OAuth Worker receives the authorization code or refresh token needed for token exchange/refresh and forwards the exchange to Feishu. The Worker is not used to receive captured conversation/article/video content.
- **Direct mode:** for a user-provided Feishu app, the Extension stores that app's client secret locally and sends the OAuth token request directly to Feishu.

The repository's Feishu Worker also performs best-effort request rate limiting using request/network metadata available to the Worker platform.

### Obsidian

Obsidian sync uses the Local REST API plugin on your computer. The current client uses a local HTTP endpoint (by default `http://127.0.0.1:27123`) and sends the configured API key in the authorization header. SyncNos does not require an external SyncNos server for this path.

### GitHub

GitHub Markdown sync uses GitHub App Device Flow. The Extension sends Device Flow, token polling/refresh, repository discovery, preflight, Git data, and managed Markdown/assets directly to GitHub over HTTPS. This GitHub path does not use a SyncNos OAuth server or Cloudflare Worker.

The GitHub App Client ID is public application metadata. The Extension does not contain a GitHub Client Secret or GitHub App private key. GitHub user access tokens, optional refresh tokens, and short-lived pending Device Flow state are stored only in extension-local storage and are excluded from SyncNos backup exports.

SyncNos `Disconnect` clears the GitHub auth state stored by this Extension on the current device. It does not revoke authorization or uninstall the GitHub App at GitHub. GitHub's **Authorized GitHub Apps → Revoke** and **Installed GitHub Apps → Configure / Uninstall** are separate GitHub-side controls.

### Image fetching and anti-hotlink handling

When image caching or anti-hotlink handling is used, the Extension may request image URLs from their original/CDN hosts. On supported browsers it may temporarily adjust request headers such as Referer for matching anti-hotlink rules. Image download failure does not block saving the captured text.

Third-party services handle data according to their own privacy policies once you send data to them.

## 5. OAuth Credentials

OAuth tokens and locally configured secrets are stored in the browser extension's local storage so the configured integrations can operate. They are excluded from SyncNos backup exports as described above. For GitHub, the same local auth state also temporarily holds the Device Flow device credential while authorization is pending.

Disconnecting an integration removes the corresponding active connection state according to that integration's current implementation. For GitHub specifically, local Disconnect is distinct from revoking the user authorization or changing/uninstalling the GitHub App installation at GitHub.

## 6. Browser Permissions

The manifest source of truth is `wxt.config.ts`. Current builds request the permissions needed for local storage, context-menu actions, tab/navigation handling, packaged script injection, scheduled auto-sync work, and anti-hotlink request handling. Browser-specific builds may use different declarative-network-request or tab-group permissions where the platform supports them.

The Extension currently declares `http://*/*` and `https://*/*` host access so it can capture arbitrary user-requested web pages and reach configured sync/OAuth/image endpoints. This broad access is not permission to upload page content by default; external transmission occurs through the features described in this policy.

## 7. Remote Code

The Extension does not download and execute remote code. Executable extension code is packaged with the Extension. Network requests exchange data with sites or services used by the features above.

## 8. Data Sharing

We do not sell your data. Data is sent to third parties only when required by a feature you configure or invoke, such as Notion, Feishu, GitHub, an OAuth token-exchange proxy used by another configured integration, an image host, or your locally running Obsidian Local REST API service.

## 9. Contact

Questions about this policy can be filed through [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues).
