---
title: Notion
description: Connect Notion and sync SyncNos content under a page you choose.
---

Open **Settings → Notion**, turn on **Sync to Notion**, and choose a connection method.

## Default connection

Click **Connect**, authorize the destination page in Notion, then return to SyncNos and confirm
that it is connected. If the callback page does not close automatically, check the connection
status in SyncNos settings.

## Connect manually

If the default authorization service is unavailable, or you prefer to use your own Notion
integration, connect manually. This does not require the SyncNos authorization service, but
still requires access to Notion.

1. In the [Notion developer portal](https://app.notion.com/developers/connections), create a
   **New connection** and select your workspace and **API token** (internal connection).
   You must be a workspace owner.
2. Make sure the connection can read, insert, and update content.
3. Open the destination page in Notion and add your connection through
   **⋯ → More → Connections → Add a new connection**.
4. Copy the integration token from the connection's configuration.
   In **SyncNos → Settings → Notion → Connect manually…**, paste it and click **Connect**.

Treat the token like a password. SyncNos stores it locally in the browser and uses it only
with the official Notion API. See [Export & backup](/docs/en/export-backup/#backup) for
credential handling in Backups.

## Choose where to sync

Select an authorized Notion page under **Destination page**.
If the page is missing from the list, check that it is shared with your current connection and
refresh; you can also choose **Choose by link…**, paste the page link, and save.

SyncNos automatically creates or reuses databases for AI chats, web articles, and videos under
the destination page. Run one manual sync to verify the result before enabling auto-sync.

### Reuse an existing database

You normally do not need to configure databases yourself.
To reuse an existing SyncNos database, open **Advanced**, paste its full-page link or
ID into the corresponding field, then press Enter or leave the field to save.
Links are automatically converted to database IDs.

The database must be directly under the destination page and compatible with SyncNos's schema.
Sync may add required properties, so do not select an unrelated database.
Clear the field or click **Reset** to find or create a database automatically.

Changing the destination page clears the database settings. Existing remote content is not moved
or deleted; subsequent syncs use the new destination.

## Disconnect and troubleshoot

**Disconnect** removes local credentials and destination settings, not synced content.
To switch connection methods or change the token, disconnect first, reconnect, and choose
the destination again. Manage the connection in Notion to revoke access or reset the token.

- Cannot reach the SyncNos authorization service: check your network, enable a proxy if needed,
  or connect manually.
- Cannot reach Notion: check your network and enable a proxy if needed. If the service is
  temporarily unavailable, try again later.
- Invalid token or insufficient access: copy the internal integration token again and check
  the connection's capabilities and destination page access.

Sync failures do not delete local content. Fix the connection or permissions and retry.
