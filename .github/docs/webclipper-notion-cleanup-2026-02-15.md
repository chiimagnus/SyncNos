## WebClipper Notion Cleanup (2026-02-15)

### Goal

Reduce duplicate / legacy Notion integration code in `Extensions/WebClipper/` while keeping behavior unchanged.

### What was removed

- Deleted unused module: `Extensions/WebClipper/src/sync/notion/oauth-client.js`
  - It was not referenced by popup/background/build scripts and duplicated logic already implemented elsewhere.

### What was refactored

- Single source of truth for AI tags:
  - Added `Extensions/WebClipper/src/sync/notion/notion-ai.js`
  - `Extensions/WebClipper/src/sync/notion/notion-db-manager.js` now uses `notionAi.buildAiOptions()`
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.js` now uses `notionAi.optionNameForSource()`
- Simplified OAuth defaults:
  - `Extensions/WebClipper/src/sync/notion/oauth-config.js` now exports `getDefaults()` only, and removed unused fields.
- Popup Notion code simplification:
  - `Extensions/WebClipper/src/ui/popup/popup-notion.js` now uses `popupCore.openHttpUrl()` to open OAuth page.
  - Popup now loads `oauth-config.js` + `notion-api.js` via script tags, and uses `notionOAuthConfig.getDefaults()` when building the authorize URL.

### Build/test upkeep

- Updated bundling to include the new modules:
  - `Extensions/WebClipper/scripts/build.mjs`
  - `Extensions/WebClipper/scripts/check.mjs`
- Updated smoke tests to load `notion-ai.js` in isolation:
  - `Extensions/WebClipper/tests/smoke/notion-db-manager.test.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

### Validation

- `npm --prefix Extensions/WebClipper run check` OK
- `npm --prefix Extensions/WebClipper test` OK
- `npm --prefix Extensions/WebClipper run build` OK

