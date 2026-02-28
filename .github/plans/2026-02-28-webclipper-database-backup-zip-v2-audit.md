# Audit Report — WebClipper Database Backup Zip v2

- Repo root: `SyncNos/`
- Plan: `.github/plans/2026-02-28-webclipper-database-backup-zip-v2-implementation-plan.md`
- Date: 2026-02-28

## TODO board (7 tasks)

1. Task 1: 定义/升级 backup 工具协议与 allowlist
2. Task 2: 增强 zip-utils：增加 unzip 读取能力（stored + deflate）
3. Task 3: Export：生成 Zip v2（manifest + index.csv + sources + config）
4. Task 4: Import：从 Zip v2 合并导入到 IndexedDB
5. Task 5: UI 文案与输入约束更新（不做国际化）
6. Task 6: 补充 Import/Export schema 的单测（关键边界）
7. Task 7: 回归检查（最小冒烟）

## Task-to-file map

- Task 1:
  - `Extensions/WebClipper/src/storage/backup-utils.js`
  - `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`
- Task 2:
  - `Extensions/WebClipper/src/export/local/zip-utils.js`
  - `Extensions/WebClipper/tests/smoke/zip-utils.test.ts`
- Task 3:
  - `Extensions/WebClipper/src/ui/popup/popup-database.js`
- Task 4:
  - `Extensions/WebClipper/src/ui/popup/popup-database.js`
  - `Extensions/WebClipper/src/export/local/zip-utils.js`
- Task 5:
  - `Extensions/WebClipper/src/ui/popup/popup.html`
- Task 6:
  - `Extensions/WebClipper/tests/smoke/backup-zip-schema.test.ts`
  - `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`
- Task 7:
  - (validation only)

## Findings (Open first)

## Finding F-01

- Task: `Task 2: 增强 zip-utils：增加 unzip 读取能力（stored + deflate）`
- Severity: `High`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/export/local/zip-utils.js:1`
- Summary: `inflateRawTiny` uses a heuristic output buffer and only grows between blocks; it can throw "data error" mid-block when the output is larger than the initial estimate (likely on large backups when `DecompressionStream` is unavailable).`
- Risk: `Zip import fails on valid deflated archives (method=8), breaking the “unzip then re-zip” compatibility requirement on browsers without DecompressionStream.`
- Expected fix: `Thread the expected uncompressed size into the deflate fallback and preallocate output to that exact size (or support safe mid-block growth).`
- Validation: `npm --prefix Extensions/WebClipper run test`
- Resolution evidence: `Commit a0603e81 wires expected uncompressed size into the fallback; full WebClipper tests pass.`

## Fix log

- `a0603e81` WebClipper zip import: fix deflate fallback sizing

## Validation log

- `npm --prefix Extensions/WebClipper run test` → PASS
- `npm --prefix Extensions/WebClipper run check` → `[check] ok`

## Final status and residual risks

- All findings resolved.
- Residual risk: `conversationKey` file name length is intentionally not limited yet (per plan “不确定项”); extremely long keys may still be awkward to extract on some filesystems.
