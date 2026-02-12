# Permissions (WebClipper)

## Required Permissions

- `storage`: Store settings, OAuth state, and tokens; store capture metadata.
- `downloads`: Export JSON/Markdown to local files.
- `tabs`: Identify the active tab for on-demand article fetch.
- `webNavigation`: Detect OAuth redirect navigation to the callback page.
- `scripting`: Inject the article fetcher into the active tab (on-demand).

## Host Permissions

The extension requests access to a small set of supported sites for automatic chat capture (see `manifest.json`).

## Optional Host Permissions

- `http://*/*`, `https://*/*`: Requested only when you use the popup `Fetch` action on a specific website to capture an article.

