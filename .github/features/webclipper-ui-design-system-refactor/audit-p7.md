# Audit P7 - webclipper-ui-design-system-refactor

范围：`plan-p7.md`（tsc noUnused 报告清理）。

## 验证记录

- `./webclipper/node_modules/.bin/tsc -p webclipper/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters` ✅
- `npm --prefix webclipper run compile` ✅
- `npm --prefix webclipper run test` ✅
- `npm --prefix webclipper run build` ✅

## 变更概览

清理未被读取的 import/const/局部变量/函数：

- `webclipper/src/collectors/notionai/notionai-collector.ts`
- `webclipper/src/collectors/yuanbao/yuanbao-markdown.ts`
- `webclipper/src/integrations/detail-header-actions.ts`
- `webclipper/src/integrations/openin/obsidian-open-target.ts`
- `webclipper/src/sync/backup/zip-utils.ts`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/ui/settings/sections/InsightPanel.tsx`

## Findings

- 无（均为 noUnused 报告且删除不改变行为）。

