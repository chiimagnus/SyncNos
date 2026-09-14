---
title: GitHub
description: Authorize with GitHub App Device Flow and sync content as Markdown to a repository branch.
---

The GitHub provider projects local SyncNos content into Markdown and managed attachments, then commits the result to a repository and branch you choose.

## Connect GitHub

1. Open **SyncNos → Settings → GitHub**.
2. Start the connection and complete GitHub Device Flow.
3. If prompted that the GitHub App is not installed, install the SyncNos GitHub App for the account / repositories you want to use.
4. Refresh the repository list and select a repository where SyncNos has content-write permission.
5. Choose or enter the target branch.
6. Click **Test**.

## Initialize an empty repository

If the connection test reports that the target repository is uninitialized, use **Initialize repository** in Settings, then test again.

Do not blindly repeat an initialization mutation. Read the current state first and retry only when needed.

## Sync

GitHub supports both manual and automatic sync. SyncNos calculates the Git file changes represented by local content and updates the target repository through the GitHub API.

Local sync mappings identify files managed by SyncNos and support later incremental changes. The browser-local database remains the primary content record.

## Authorization and privacy

GitHub Device Flow access / refresh tokens and pending credentials are stored in extension-local storage and excluded from Backup ZIP.

**Disconnect** only clears SyncNos's local GitHub authentication state. Revoking authorization or uninstalling the GitHub App is a separate action on GitHub.

## Troubleshooting

- **Repository is missing from the list**: confirm that the SyncNos GitHub App is installed for the account / organization and has access to the target repository, then refresh the repository list.
- **Write permission is missing**: both the GitHub App Contents permission and the current user's repository permission must allow writes.
- **An empty repository cannot be tested**: use **Initialize repository**, then test again.
- **Branch not found**: choose an existing branch or use the repository's default branch.

A failed sync does not delete the original local content. Check the current remote state and permissions before retrying.
