# Audit Report — WebClipper remove compat layer (WXT)

- Repo root: `SyncNos/`
- Target plan: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md`
- Scope: `Extensions/WebClipper/`
- Note: `references/finding-template.md` is not present in this repo; this report uses an equivalent findings structure.

## TODO Board (1 per Task)

- [x] Task 1 — add no-compat check scaffold (`d612f224`)
- [x] Task 2 — add collector env and registry wiring (`41933440`)
- [x] Task 3 — factoryize collectors batches (`125ccf8c`, `05c92bee`, `e73b840b`)
- [x] Task 3B — switch content entry to explicit registry (`49271843`)
- [x] Task 4 — remove background instance globals (`3659092c`)
- [x] Task 5 — create background services container (`84d66bbe`)
- [x] Task 6 — inject deps into sync/settings handlers (`cf4ed172`)
- [x] Task 7 — add notion/obsidian services types (`acfcc1bd`)
- [x] Task 8 — make notion api modules pure (`30b738bb`)
- [x] Task 9 — remove NS injection from notion modules (`48552b01`)
- [x] Task 10 — notion orchestrator uses explicit deps (`c5ba05f5`)
- [x] Task 10A — add layered unit tests (`2bf69637`)
- [x] Task 11 — remove runtimeContext from obsidian sync (`d862d55d`)
- [x] Task 12 — remove runtimeContext from shared/local (`51f9bc12`)
- [x] Task 13 — remove `globalThis.WebClipper` injection from tests (`8242c3a9`)
- [x] Task 14 — delete compat layer files + clear refs (`3d487939`)
- [x] Task 15 — update WebClipper AGENTS module index (`b34729d0`)

Out-of-plan but required to keep behavior stable:
- `fix: notion cursor null treated as missing` (`7013c162`) — prevents treating `null` cursor as sequence `0` (rebuild vs append).

## Task → Files Map (high level)

- Task 1: `Extensions/WebClipper/scripts/check-no-compat.mjs`, `Extensions/WebClipper/package.json`
- Task 2–3B: `Extensions/WebClipper/src/collectors/**`, `Extensions/WebClipper/entrypoints/content.ts`
- Task 4–6: `Extensions/WebClipper/entrypoints/background.ts`, `Extensions/WebClipper/src/bootstrap/**`, `Extensions/WebClipper/src/*/background-handlers.ts`
- Task 7–11: `Extensions/WebClipper/src/sync/notion/**`, `Extensions/WebClipper/src/sync/obsidian/**`, `Extensions/WebClipper/src/bootstrap/background-services.ts`
- Task 12: `Extensions/WebClipper/src/shared/**`, `Extensions/WebClipper/src/ui/inpage/**`, `Extensions/WebClipper/src/sync/local/**`
- Task 13: `Extensions/WebClipper/tests/**`
- Task 14: deleted `Extensions/WebClipper/src/runtime-context.ts`, deleted `Extensions/WebClipper/src/export/bootstrap.ts`, removed remaining imports/usages across `Extensions/WebClipper/src/**`
- Task 15: `Extensions/WebClipper/AGENTS.md`

## Findings (read-only phase)

No correctness or plan-acceptance violations found.

### Acceptance checklist

- [x] `runtime-context.ts` + `export/bootstrap.ts` removed
- [x] `rg -n "runtimeContext\\b|globalThis\\.WebClipper" Extensions/WebClipper/{src,entrypoints,tests}` has no hits
- [x] `npm --prefix Extensions/WebClipper run test` passes
- [x] `npm --prefix Extensions/WebClipper run compile` passes
- [x] `npm --prefix Extensions/WebClipper run check:no-compat` passes

## Validation Log

- `npm --prefix Extensions/WebClipper run test` ✅
- `npm --prefix Extensions/WebClipper run compile` ✅
- `npm --prefix Extensions/WebClipper run check:no-compat` ✅

