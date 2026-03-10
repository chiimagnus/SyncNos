# Plan P2 - webclipper-inpage-visibility-and-ai-autosave

**Goal:** 优化设置页信息架构，并给 inpage 按钮增加右键菜单，降低用户对“自动/展示范围”的误解成本。

**Non-goals:**
- 不做即时生效（仍按当前“刷新后生效”的模型）。
- 不引入复杂的站点级配置矩阵。

**Approach:** 在保持底层存储键不变的前提下，重排设置页 UI：将原 `Inpage` 语义改为更通用的行为设置入口，并将“页面内按钮显示范围”和“AI 自动保存”拆成两个卡片；inpage 按钮增加 `contextmenu` 右键菜单，提供快捷切换。

**Acceptance:**
- 设置页侧边栏 `Inpage` 显示为 `General/通用`，描述同步调整。
- “显示范围”选择控件与 label 同行右对齐展示。
- inpage 按钮支持右键打开菜单，并可写入 `inpage_display_mode` / `ai_chat_auto_save_enabled`。
- 通过 `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test`。

---

## P2-T1 设置页改为通用分组并拆分卡片

**Files:**
- Modify: `webclipper/src/ui/settings/sections/InpageSection.tsx`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`

**Step 1: 实现功能**
- 侧边栏 label/desc 将 `section_inpage_label/desc` 改为通用语义（General/通用）。
- `InpageSection` 内拆成两个 card：`Inpage Button`（显示范围）与 `Auto-save`（开关）。
- “显示范围” select 改为同行右对齐布局（label 左、select 右）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript compile 通过。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/sections/InpageSection.tsx webclipper/src/i18n/locales/en.ts webclipper/src/i18n/locales/zh.ts .github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`
- Run: `git commit -m "refactor: task4 - 重排通用设置卡片与布局"`

---

## P2-T2 Inpage 按钮右键菜单（快速切换显示/自动保存）

**Files:**
- Modify: `webclipper/src/ui/inpage/inpage-button-shadow.ts`
- Modify: `webclipper/tests/smoke/inpage-button-click-combo.test.ts`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`

**Step 1: 实现功能**
- 监听 `contextmenu`，右键打开菜单（不影响单击保存/双击打开面板/连击彩蛋）。
- 菜单支持：
  - 快速切换 `inpage_display_mode`（supported/all/off，含旧键兼容读默认）
  - 快速切换 `ai_chat_auto_save_enabled`
- 菜单操作完成后展示 inpage tip 反馈（简短，提示“刷新后生效”）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run test -- tests/smoke/inpage-button-click-combo.test.ts`
- Expected: 通过。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/inpage/inpage-button-shadow.ts webclipper/tests/smoke/inpage-button-click-combo.test.ts webclipper/src/i18n/locales/en.ts webclipper/src/i18n/locales/zh.ts .github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`
- Run: `git commit -m "feat: task5 - Inpage按钮右键菜单快速设置"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
