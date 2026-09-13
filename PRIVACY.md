# Privacy Policy

**Last Updated: 2026-09-13**

This policy covers SyncNos WebClipper on supported Chromium, Firefox-family, and Safari builds.

## Local-first design

SyncNos saves captured content to browser-local storage before any optional sync or export. External providers and exported files are derived copies.

Depending on the feature you use, SyncNos may read page data needed for capture, including AI conversation messages, article text and metadata, supported video-page metadata and already-loaded transcripts, image URLs, and text selections used for article comments.

Supported non-virtualized AI sites can auto-save when AI auto-save is enabled. ChatGPT and Google AI Studio require manual capture. Article and Video capture are manually initiated.

## Local data, exports, and backups

Durable captured content is stored in browser IndexedDB. Extension local storage holds settings, OAuth/auth state, provider configuration, queues/jobs, and other small state.

Selected Markdown/JSON exports are assembled locally from the selected items and referenced cached images that can be materialized from those items. They do not include sync mappings, article comments, settings, or provider credentials, and exporting does not trigger a new image download.

Backup ZIP is a separate recovery package. It may contain captured content, recoverable sync mappings, cached images, article comments, and non-sensitive settings. Authentication secrets are excluded, including provider access/refresh tokens, client secrets, the Obsidian API key, GitHub Device Flow credentials, and the Reader TTS AI API key. Machine/profile-specific CLI identity and opt-in state are also excluded.

See [storage, backup, and recovery](docs/storage.md) for the recovery contract.

## Local CLI and Native Messaging

Local CLI Integration is opt-in per browser profile. On supported non-Safari builds, SyncNos requests the optional `nativeMessaging` permission only when you enable this integration.

The Extension connects to the local `app.syncnos.cli` Native Messaging host, which communicates with `syncnos` over same-user local IPC: Unix domain sockets on macOS/Linux and a local named pipe on Windows. The host does not expose a remote SyncNos network service or maintain a second SyncNos database.

`syncnos install` checks a finite set of known browser locations and writes current-user Native Messaging registrations. It does not crawl the disk or inspect browser profile databases. CLI responses exclude provider secrets and the Reader TTS AI API key; local file import/export uses paths explicitly supplied by the user.

## External network destinations

External sync is optional. Each provider can be synchronized manually and may also be configured for auto-sync.

### Notion

Notion sync sends selected local content to the Notion API over HTTPS. When needed, referenced images may also be fetched and uploaded to Notion.

Notion OAuth uses a token-exchange proxy so the official client secret is not embedded in the Extension. The proxy receives OAuth exchange data, not captured conversation/article/video content.

### Feishu (Lark)

Feishu sync sends selected local content to Feishu APIs over HTTPS.

Feishu OAuth supports two modes:

- **Proxy:** the configured Worker receives the authorization code or refresh token and performs the token exchange/refresh with Feishu. It does not receive captured content. The Worker platform may expose ordinary request/network metadata used for best-effort rate limiting.
- **Direct:** for a user-managed Feishu app, the Extension stores the configured client secret locally and sends OAuth token requests directly to Feishu.

### Obsidian

Obsidian sync uses the Local REST API plugin on the same computer. The current integration accepts a local HTTP endpoint (default `http://127.0.0.1:27123`) and sends the configured API key in the authorization header. This path does not require a SyncNos cloud service.

### GitHub

GitHub sync uses GitHub App Device Flow and sends authorization, repository, Git, Markdown, and managed asset requests directly to GitHub over HTTPS. SyncNos does not embed a GitHub Client Secret or App private key.

GitHub access/refresh tokens and pending Device Flow credentials remain in extension-local storage and are excluded from Backup ZIP. SyncNos **Disconnect** clears the Extension's local GitHub auth state; revoking authorization or uninstalling the GitHub App is a separate action on GitHub.

### Image hosts

When image caching or anti-hotlink handling is used, SyncNos may request original/CDN image URLs. Supported browsers may temporarily adjust headers such as `Referer` for configured anti-hotlink rules. Image download failure does not block saving captured text.

Third-party services process data under their own privacy policies once data is sent to them.

## Credentials and permissions

OAuth tokens and locally configured secrets are stored in extension-local storage and excluded from Backup ZIP as described above.

The manifest source of truth is `wxt.config.ts`. Current builds request permissions for local storage, context menus, tab/navigation handling, packaged script injection, scheduled work, and anti-hotlink request handling. Browser-specific builds may differ where platform APIs differ.

Non-Safari builds declare `nativeMessaging` as optional. Disabling Local CLI Integration removes that permission when the browser exposes the removal API; permission revocation also disables the stored integration state.

SyncNos declares `http://*/*` and `https://*/*` host access so it can capture user-requested pages and contact configured sync/OAuth/image endpoints. Broad host access does not mean page content is uploaded by default.

## Remote code and data sharing

Executable Extension code is packaged with SyncNos; the Extension does not download and execute remote code.

We do not sell your data. Data is sent to third parties only when required by a feature you configure or invoke, such as a sync provider, OAuth exchange service, image host, or your local Obsidian service.

## Contact

Questions about this policy can be filed through [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues).
