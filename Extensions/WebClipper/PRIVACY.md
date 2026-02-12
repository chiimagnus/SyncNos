# Privacy (WebClipper)

WebClipper stores captured content locally in your browser and only sends data to Notion when you manually trigger sync.

## What Data Is Collected

- Chat conversations you view on supported sites (ChatGPT, NotionAI, and other enabled chat platforms).
- Article content you manually fetch via the popup `Fetch` action.
- Minimal metadata for each item: title, URL, capture time, and warning flags (when applicable).

## Where Data Is Stored

- Local browser storage (IndexedDB + `chrome.storage.local`) inside the extension.
- Notion access token is stored in `chrome.storage.local` after OAuth completes.

## When Data Leaves Your Browser

- Only when you click `Sync` in the popup, the extension calls Notion APIs to create/update pages and databases.
- OAuth token exchange calls Notion's token endpoint.

## Permissions

See `PERMISSIONS.md` for a full list and why each permission is needed.

