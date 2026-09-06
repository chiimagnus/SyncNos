# Documentation Metadata

This file records the source baseline and ownership rules used for the long-term documentation set. It is metadata, not another product guide.

## Repository State

| Field | Value |
| --- | --- |
| Repository | `SyncNos` WebClipper codebase (origin: `chiimagnus/SyncNos`) |
| Commit hash | `2e75adfdd9bfc36503c164def288ec1e0fcc638e` |
| Generated at | `2026-09-05` |

The commit above is the code baseline at the start of this documentation reconciliation. Documentation-only edits do not advance it.

## Long-term Documentation Set

- `README.md` and `README.zh-CN.md`: five-minute product entry, supported capture/output summary, and links to canonical guides.
- `AGENTS.md` and `src/ui/AGENTS.md`: repository and UI-specific implementation constraints for agents and contributors.
- `PRIVACY.md`: privacy boundaries and external-service disclosure.
- `docs/CONTRIBUTING.md`: development workflow and validation requirements.
- `docs/storage.md`: local-source-of-truth, IndexedDB consistency/reload-free recovery, backup, secret-exclusion, and recovery contracts.
- `docs/export-json-v1.md`: canonical selected JSON v1 archive/schema, content-fidelity, attachment, exclusion, and compatibility contract.
- `docs/troubleshooting.md`: durable troubleshooting guidance.
- `docs/guide/feishu/DocxSync.en.md` and `docs/guide/feishu/DocxSync.zh.md`: Feishu setup.
- `docs/guide/obsidian/LocalRestAPI.en.md` and `docs/guide/obsidian/LocalRestAPI.zh.md`: Obsidian Local REST API setup.
- `docs/GENERATION.md`: this baseline and ownership record.

## Documentation Ownership

- README owns only the top-level feature/output summary and navigation; it does not duplicate provider setup or maintain a static Settings screenshot that can drift from the live UI.
- Maintained provider-specific setup belongs in the corresponding guide under `docs/guide/`; GitHub currently has no standalone setup guide, so README keeps only the top-level target summary.
- Runtime structure, symbols, callers, and module relationships belong to CodeGraph and source code rather than duplicated module-index Markdown.
- `PRIVACY.md` owns external GitHub network/auth disclosure and the distinction between local Disconnect, GitHub authorization revoke, and GitHub App installation controls.
- `docs/storage.md` owns durable local-data consistency/retry semantics, backup recovery, GitHub local-secret/backup-exclusion, sync-mapping, and cleanup-outbox recovery boundaries; implementation topology stays in source/CodeGraph and provider setup remains in the provider guides.
- `docs/export-json-v1.md` owns the public selected JSON export schema and archive compatibility rules. It must not absorb Backup ZIP restore semantics, internal IndexedDB schema, or provider setup.
- `docs/overview.md` is intentionally retired. README is the top-level navigation surface; do not recreate `docs/overview.md` or a duplicate `docs/configuration.md`.
- `.github/features/**` and `.github/archived_features/**` are execution/history material, not canonical long-term architecture documentation.

## Coverage Policy

No additional long-term page beyond the set above is required by the current code baseline. Add another page only when a durable product contract, operational procedure, privacy boundary, or recovery rule cannot be inferred from source code and does not already have a canonical owner above.
