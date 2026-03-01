# Audit Report: WebClipper Obsidian Local REST API Refactor

- Plan: `.github/plans/2026-03-01-webclipper-obsidian-local-rest-api-refactor-implementation-plan.md`
- Repo root: `SyncNos/`
- Audit date: 2026-03-01

## TODO Board (13 Tasks)

1. Task 1: Message contracts + background router routes (remove URI mode)
2. Task 2: Obsidian settings store (background-only storage)
3. Task 3: Local REST API client (HTTP-only)
4. Task 4: Deterministic note path + sync metadata codec
5. Task 5: Sync orchestrator skeleton
6. Task 6: Remote existence based sync decision
7. Task 7: Markdown writer (PUT full, PATCH append, PATCH frontmatter)
8. Task 8: Conflict detection + fallback
9. Task 9: Popup action switch to background sync
10. Task 10: Popup settings + connection test
11. Task 11: Sync status visibility + force full action
12. Task 12: Docs update
13. Task 13: End-to-end smoke + build verification

## Task-to-File Map

- Task 1:
  - `Extensions/WebClipper/src/protocols/message-contracts.js`
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
  - `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`
- Task 2:
  - `Extensions/WebClipper/src/export/obsidian/obsidian-settings-store.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
- Task 3:
  - `Extensions/WebClipper/src/export/obsidian/obsidian-local-rest-client.js`
  - `Extensions/WebClipper/tests/smoke/obsidian-local-rest-client.test.ts`
- Task 4:
  - `Extensions/WebClipper/src/export/obsidian/obsidian-note-path.js`
  - `Extensions/WebClipper/src/export/obsidian/obsidian-sync-metadata.js`
  - `Extensions/WebClipper/tests/smoke/obsidian-note-path.test.ts`
  - `Extensions/WebClipper/tests/smoke/obsidian-sync-metadata.test.ts`
- Task 5-8:
  - `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
  - `Extensions/WebClipper/src/export/obsidian/obsidian-markdown-writer.js`
  - `Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts`
  - `Extensions/WebClipper/tests/smoke/obsidian-markdown-writer.test.ts`
- Task 9-11:
  - `Extensions/WebClipper/src/ui/popup/popup.html`
  - `Extensions/WebClipper/src/ui/popup/popup-core.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/src/ui/popup/popup-list.js`
  - `Extensions/WebClipper/src/ui/popup/popup-obsidian-sync.js`
  - `Extensions/WebClipper/src/ui/popup/popup-obsidian-sync-state.js`
  - `Extensions/WebClipper/src/ui/styles/popup.css`
  - `Extensions/WebClipper/tests/smoke/popup-obsidian-sync.test.ts`
  - `Extensions/WebClipper/tests/smoke/popup-obsidian-sync-state.test.ts`
- Task 12:
  - `Extensions/WebClipper/AGENTS.md`
  - `.github/docs/webclipper-obsidian-local-rest-api-sync.md`
- Task 13:
  - `Extensions/WebClipper/tests/smoke/obsidian-e2e-flow.test.ts`

## Findings (Open First)

## Finding F-01

- Task: `Task 11: 同步状态可观测性（per-conversation mode/ok/error + force-full）+ 测试`
- Severity: `Low`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/popup/popup-list.js:312`
- Summary: force-full action hardcodes message type string (`"obsidianSyncConversations"`) instead of using `message-contracts.js` constants.
- Risk: refactors to message type names can silently break force-full sync (no compile-time coverage); also violates project guideline to avoid scattered hardcoded message types.
- Expected fix: read `OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS` from `NS.messageContracts` inside `popup-list.js` (fallback to current string for load-order safety).
- Validation: `npm --prefix Extensions/WebClipper run test` and `npm --prefix Extensions/WebClipper run check`
- Resolution evidence: commit `d10f34aa`; `npm --prefix Extensions/WebClipper run test` (pass), `npm --prefix Extensions/WebClipper run check` (pass)

## Fix Log

- Resolved F-01: use message contracts for force-full sync in popup list.

## Validation Log

- Pre-fix validation (already done during implementation):
  - `npm --prefix Extensions/WebClipper run test` (pass)
  - `npm --prefix Extensions/WebClipper run check` (pass)
  - `npm --prefix Extensions/WebClipper run build` (pass)

## Final Status / Residual Risks

- All findings resolved.
