# Documentation Metadata

This file records the source baseline and ownership rules used for the long-term documentation set. It is metadata, not another product guide.

## Repository State

| Field | Value |
| --- | --- |
| Repository | `SyncNos-Webclipper` (origin: `chiimagnus/SyncNos`) |
| Commit hash | `fc2c806f28d4cd29b22d4375d2ee36bd14e7822f` |
| Generated at | `2026-08-26` |

## Documentation Ownership

- `README.md` and `README.zh-CN.md` own the top-level feature/output summary and links only; they do not duplicate integration setup.
- `docs/guide/github/GitHubSync.en.md` and `docs/guide/github/GitHubSync.zh.md` are the canonical user setup guides for GitHub App Device Flow, installation scope, repository/branch selection, folders, Test Connection, sync behavior, and troubleshooting.
- GitHub runtime behavior is owned by `src/services/sync/github/**`; the guide should describe user-visible behavior without copying implementation constants that are already enforced by code.
- `PRIVACY.md` owns external GitHub network/auth disclosure and the distinction between local Disconnect, GitHub authorization revoke, and GitHub App installation controls.
- `docs/storage.md` owns GitHub local-secret, backup-exclusion, sync-mapping, and cleanup-outbox recovery boundaries; setup instructions must remain in the GitHub guide instead of being duplicated there.
- `docs/overview.md` was intentionally retired from the long-term documentation set; README is the current top-level navigation surface. Do not recreate `docs/overview.md` or a duplicate `docs/configuration.md`.
