# Documentation Metadata

This file records the source baseline and ownership rules used for the long-term documentation set. It is metadata, not another product guide.

## Repository State

| Field | Value |
| --- | --- |
| Repository | `SyncNos` WebClipper codebase (origin: `chiimagnus/SyncNos`) |
| Commit hash | `c3337109ac3e54e9bf2bc18a9d89812769489c60` |
| Generated at | `2026-08-28` |

The commit above is the code baseline at the start of this documentation reconciliation. Documentation-only edits do not advance it.

## Long-term Documentation Set

- `README.md` and `README.zh-CN.md`: five-minute product entry, supported capture/output summary, and links to canonical guides.
- `AGENTS.md` and `src/ui/AGENTS.md`: repository and UI-specific implementation constraints for agents and contributors.
- `PRIVACY.md`: privacy boundaries and external-service disclosure.
- `docs/CONTRIBUTING.md`: development workflow and validation requirements.
- `docs/storage.md`: local-source-of-truth, backup, secret-exclusion, and recovery contracts.
- `docs/troubleshooting.md`: durable troubleshooting guidance.
- `docs/guide/feishu/DocxSync.en.md` and `docs/guide/feishu/DocxSync.zh.md`: Feishu DocX setup.
- `docs/guide/github/GitHubSync.en.md` and `docs/guide/github/GitHubSync.zh.md`: GitHub Markdown sync setup.
- `docs/guide/obsidian/LocalRestAPI.en.md` and `docs/guide/obsidian/LocalRestAPI.zh.md`: Obsidian Local REST API setup.
- `docs/GENERATION.md`: this baseline and ownership record.

## Documentation Ownership

- README owns only the top-level feature/output summary and navigation; it does not duplicate provider setup or maintain a static Settings screenshot that can drift from the live UI.
- Provider-specific setup belongs in the corresponding guide under `docs/guide/`.
- Runtime structure, symbols, callers, and module relationships belong to CodeGraph and source code rather than duplicated module-index Markdown.
- GitHub runtime behavior is owned by `src/services/sync/github/**`; the guide describes user-visible behavior without copying implementation constants already enforced by code.
- `PRIVACY.md` owns external GitHub network/auth disclosure and the distinction between local Disconnect, GitHub authorization revoke, and GitHub App installation controls.
- `docs/storage.md` owns GitHub local-secret, backup-exclusion, sync-mapping, and cleanup-outbox recovery boundaries; setup instructions remain in the GitHub guide.
- `docs/overview.md` is intentionally retired. README is the top-level navigation surface; do not recreate `docs/overview.md` or a duplicate `docs/configuration.md`.
- `.github/features/**` and `.github/archived_features/**` are execution/history material, not canonical long-term architecture documentation.

## Coverage Policy

No additional long-term page is required by the current code baseline. Add a page only when a durable product contract, operational procedure, privacy boundary, or recovery rule cannot be inferred from source code and does not already have a canonical owner above.
