# GitHub Markdown Sync Setup (WebClipper)

**English** | [中文](./GitHubSync.zh.md)

This guide covers the user-facing setup for syncing SyncNos WebClipper content to GitHub as Markdown. Runtime behavior remains owned by `src/services/sync/github/**`.

## Before you start

- Content should already be saved locally in SyncNos WebClipper.
- Sign in to the GitHub account that should authorize SyncNos.
- The target repository must already contain at least one commit.
- If the repository belongs to an organization, you may need permission to install or configure the SyncNos GitHub App for that organization.

## 1. Connect GitHub with Device Flow

Open WebClipper → `Settings` → `GitHub`, then click `Connect GitHub`.

SyncNos requests a GitHub Device Flow directly from GitHub and shows a temporary code. Open the official device page:

`https://github.com/login/device`

Enter the temporary code there only. Do not paste it into another site, chat, issue, or support request, and do not share it with another person. If the code expires, return to SyncNos and click `Connect GitHub` again to start a new flow.

SyncNos does not ask you to create or paste a Personal Access Token (PAT). GitHub authentication and token refresh are performed directly between the browser extension and GitHub; there is no SyncNos OAuth server or Cloudflare Worker in this GitHub path.

## 2. Install or configure the SyncNos GitHub App

After authorization, SyncNos discovers repositories through the SyncNos GitHub App installation that GitHub makes available to the signed-in user.

The GitHub App repository scope is the boundary that determines which repositories SyncNos can see. The installation needs:

- **Contents: Read and write**
- **Metadata: Read**

If Settings reports that the app is not installed, use `Install / Configure GitHub App`. If the app is already installed but the desired repository is absent, configure the installation and grant access to that repository.

SyncNos does not silently replace a saved repository when access is removed. The saved target remains visible as unavailable until you restore access or explicitly choose another authorized writable repository.

## 3. Choose repository, branch, and folders

In WebClipper → `Settings` → `GitHub`:

1. Choose an authorized repository with content write access.
2. Enter the target branch. The branch must already exist.
3. Configure the optional repository-relative folders for AI chats, web articles, and video scripts.
4. Leave a field or press Enter to save changes.

Folder paths can be nested, for example `sync/chats`. They must remain relative to the repository root. Absolute paths, traversal such as `..`, backslashes, empty path segments, and `.github/workflows/**` are rejected rather than rewritten into another path.

Changing a folder while keeping the same repository and branch moves SyncNos-managed output on the next sync: the new path is written and the previous managed path is cleaned up. Changing repository or branch changes the target identity, so SyncNos does not clean the previous target across repositories or branches.

## 4. Test the connection

Click `Test connection` after choosing the target.

The test validates the current GitHub account, GitHub App installation access, repository, and branch preflight. It does **not** create a test file or a test commit.

A successful preflight does not guarantee that every future write is allowed by branch protection or repository rulesets. A real sync can still receive GitHub `403` or `422` responses when the final ref update is blocked. In that case, choose a branch the GitHub App is allowed to update or adjust the repository ruleset. Do not use force push or protection-bypass workarounds as a SyncNos fix.

## 5. Sync behavior

GitHub is a derived output. SyncNos remains the local source of truth.

- Manual sync is always available when the provider is enabled and configured.
- Optional GitHub auto-sync can be enabled explicitly in Settings.
- An unchanged projection produces no content commit.
- Manual reconcile can overwrite edits made directly to SyncNos-managed Markdown files on GitHub so the remote projection matches local data again.
- On the same repository/branch, title or folder changes can delete the previous managed path and write the replacement in the same content commit. A previously managed remote path that is already absent is treated as already cleaned up.
- Local deletion is represented as managed remote cleanup. If GitHub is temporarily unavailable, cleanup remains recoverable and can be retried later.
- Cached-image read or upload failures are reported as warnings; Markdown text can still sync successfully.

Repository content outside SyncNos-managed paths, such as an unrelated `README.md`, is not part of the managed projection and should remain untouched.

## 6. Disconnect, revoke authorization, or uninstall the app

These are different operations:

- **SyncNos `Disconnect`**: removes the GitHub credentials stored by this extension on the current device. Repository, branch, and folder preferences are kept.
- **GitHub → Settings → Applications → Authorized GitHub Apps → Revoke**: revokes the user authorization at GitHub and invalidates the associated user tokens.
- **GitHub → Settings → Applications → Installed GitHub Apps → Configure / Uninstall**: changes or removes the GitHub App installation and its repository access.

Use `Disconnect` when you only want this local SyncNos installation signed out. Use GitHub's authorization or installation controls when you want to revoke access at GitHub itself.

## Troubleshooting

### The temporary code expired

Return to SyncNos Settings and start `Connect GitHub` again. Use the newly displayed code only at `https://github.com/login/device`.

### The GitHub App is not installed or no repository is available

Open `Install / Configure GitHub App`, make sure the app is installed for the correct account or organization, and grant the installation access to the target repository. Then return to SyncNos and refresh repositories.

### The saved repository is unavailable

The existing selection is intentionally preserved instead of being silently replaced. Restore GitHub App access or explicitly choose another writable repository.

### Branch preflight fails

Confirm that the branch already exists and that the repository already has at least one commit. Then verify that the GitHub App installation can access the repository.

### Sync fails with 403 or 422 after Test Connection succeeded

Check branch protection and repository rulesets. Use a branch the GitHub App is permitted to update or adjust the ruleset to permit the intended app write. Do not force push or disable protections merely to make SyncNos pass.

### Images are missing but Markdown synced

Image caching/upload is best effort. Inspect the SyncNos sync warning state, then retry after the local image cache or GitHub connection is available. The textual Markdown projection is not blocked solely by an image failure.
