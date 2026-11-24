---
title: Notion
description: Connect Notion and sync SyncNos content under a page you choose.
---

## Connect

1. Open **SyncNos → Settings → Notion**.
2. Click **Connect** and select the pages to authorize in Notion.
3. Choose a **Destination page**.
4. Run one manual sync and confirm the result.

Enable auto-sync only if you want it.

## Connect manually (advanced)

If the default authorization service is unavailable, or you prefer to use your own Notion integration,
connect manually instead. This does not depend on the SyncNos authorization server, but still requires access to Notion.

1. Open the [Notion developer portal](https://app.notion.com/developers/connections), create a
   **New connection**, select **API token** (internal connection), and choose your workspace.
   You must be a workspace owner.
2. Enable the Read content, Insert content, and Update content capabilities in the connection settings.
3. Open your destination page in Notion, choose **⋯ → More → Connections → Add a new connection**,
   and select your new connection.
4. Return to the connection's configuration page and copy the integration token.
5. In **SyncNos → Settings → Notion → Connect manually…**, paste the token and click **Connect**.
6. Choose the **Destination page** and run one manual sync to confirm the result.

Treat the token like a password. Do not publish or share it.
SyncNos stores it locally in this browser and sends it only to the official Notion API. Standard backups exclude it.

## Sync location

SyncNos can access only pages shared with the current integration.
If your destination is missing, add the integration to the page in Notion and refresh,
or select **Choose by link…** in the destination menu and paste the shared page's link.

SyncNos organizes content under the selected page automatically. You do not need to create or
edit a database yourself. To reuse a particular database, open **Advanced options** and paste its
full-page link or ID into the field for that content type. It must be under the selected destination
page. Clear the field or click **Reset** to restore automatic selection.

Changing the destination page sends future syncs to the new location.

## Disconnect and troubleshoot

To switch connection methods or change the token, click **Disconnect** first, reconnect, and choose the destination page again.
Disconnect removes local credentials and destination settings, not content already synced to Notion.
To revoke authorization or reset a token, use Notion's integration settings.

If the default authorization service is unavailable, try manual connection.
If Notion itself is unreachable, check your network and enable a proxy if needed before retrying.

Sync failures do not affect local content. Fix the connection and retry.
