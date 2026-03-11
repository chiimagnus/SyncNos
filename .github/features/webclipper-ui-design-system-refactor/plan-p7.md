# Plan P7 - webclipper-ui-design-system-refactor

**Goal:** 删除 TypeScript `noUnusedLocals/noUnusedParameters` 报告的真实 dead code，确保“冗余清理”可验证、可回归。

**Non-goals:**
- 不改变业务行为（只删未被读取的 import/const/局部变量/函数）。
- 不改动 i18n 文案。

**Acceptance:**
- `./webclipper/node_modules/.bin/tsc -p webclipper/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters` 无报错。
- `npm --prefix webclipper run compile/test/build` 通过。

---

## P7-T1 删除 tsc(noUnused*) 报告的 dead code

**Files (expected):**
- Modify: `webclipper/src/collectors/notionai/notionai-collector.ts`
- Modify: `webclipper/src/collectors/yuanbao/yuanbao-markdown.ts`
- Modify: `webclipper/src/integrations/detail-header-actions.ts`
- Modify: `webclipper/src/integrations/openin/obsidian-open-target.ts`
- Modify: `webclipper/src/sync/backup/zip-utils.ts`
- Modify: `webclipper/src/ui/app/AppShell.tsx`
- Modify: `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- Modify: `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`
- Add: `.github/features/webclipper-ui-design-system-refactor/plan-p7.md`

**Step 1: 删除 unused**
- 按 `tsc --noUnusedLocals --noUnusedParameters` 的报错逐个移除未使用的符号。

**Step 2: 验证（严格）**
- Run: `./webclipper/node_modules/.bin/tsc -p webclipper/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters`
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/collectors/notionai/notionai-collector.ts webclipper/src/collectors/yuanbao/yuanbao-markdown.ts webclipper/src/integrations/detail-header-actions.ts webclipper/src/integrations/openin/obsidian-open-target.ts webclipper/src/sync/backup/zip-utils.ts webclipper/src/ui/app/AppShell.tsx webclipper/src/ui/settings/hooks/useSettingsSceneController.ts webclipper/src/ui/settings/sections/InsightPanel.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p7.md`
- Run: `git commit -m \"chore: task29 - 清理 tsc noUnused 报告\"`

---

## P7-T2 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m \"chore: task30 - P7 验证通过（compile/test/build）\"`

---

## Phase Audit

- Audit file: `audit-p7.md`

