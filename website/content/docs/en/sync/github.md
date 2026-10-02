---
title: GitHub
description: Sync SyncNos content as Markdown into a GitHub repository.
---

## Connect

1. Open **SyncNos → Settings → GitHub**.
2. Click **Connect** and finish authorization.
3. Install the SyncNos GitHub App for the account or repositories you want to use when prompted.
4. Choose a repository and branch.
5. Click **Test**.

If an empty repository is not initialized yet, use **Initialize repository** first.

## Sync and disconnect

Once connected, run manual sync or enable auto-sync. SyncNos writes Markdown and attachments to the selected repository and branch.

**Disconnect** removes only the SyncNos connection. Revoke GitHub authorization or uninstall the App from GitHub itself.

## Troubleshoot

- Repository missing: check the GitHub App's repository access and refresh the list.
- No write access: confirm both the App and current account can write to the repository.
- Branch missing: choose an existing or default branch.

Sync failures do not delete local content.
