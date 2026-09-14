---
title: GitHub
description: Sync SyncNos content as Markdown to a GitHub repository.
---

## Connect GitHub

1. Open **SyncNos → Settings → GitHub**
2. Click **Connect** and complete GitHub authorization
3. If prompted, install the SyncNos GitHub App for the account or repositories you want to use
4. Refresh the repository list and choose the destination repository
5. Choose the destination branch
6. Click **Test**

## Empty repositories

If Test reports that the repository is not initialized, click **Initialize repository**, then test again.

## Sync

Once connected, sync manually or enable automatic sync.

SyncNos writes Markdown and attachments to the repository and branch you selected.

## Disconnect

**Disconnect** removes the GitHub connection from SyncNos.

To revoke GitHub authorization or uninstall the GitHub App, do that from GitHub as well.

## When something fails

- **Repository is missing**: check that the GitHub App can access it, then refresh the list
- **No write permission**: make sure both the GitHub App and your account can write to the repository
- **Empty repository cannot be tested**: use **Initialize repository** first
- **Branch not found**: choose an existing branch or the default branch

A failed sync does not delete local content. Fix the problem and sync again.
