# Plan P2 - webclipper-inpage-visibility-and-ai-autosave

**Goal:** 优化设置页信息架构与交互（下拉靠右、改名为【通用】、拆分页面内按钮与自动保存），并在浏览器右键菜单提供快捷开关入口。

**Non-goals:**
- 不做“inpage 按钮右键弹自定义菜单”（优先走浏览器 context menu）。
- 不做即时生效（仍保持“刷新后生效”的最简单模型）。

**Approach:** 设置页将原 `Inpage` section 改名为【通用】，内部拆分两张卡片：页面内按钮（显示范围三态）与自动保存（AI 聊天自动保存开关）。另外在 background 注册浏览器右键菜单项，读写同一组 `chrome.storage.local` 键。

**Acceptance:**
- 设置页下拉控件与标题同排靠右。
- Settings sidebar 中 section 文案显示为【通用】。
- 浏览器右键菜单可快速切换显示范围三态与自动保存开关。
- `npm --prefix webclipper run compile` 通过。

---

## P2-T1 设置页重构为【通用】并拆分卡片

**Files:**
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Add: `webclipper/src/ui/settings/sections/GeneralSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/InpageSection.tsx`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`
- Modify: `webclipper/tests/unit/settings-sections.test.ts` (如断言依赖 section label/desc)
- Modify: `.github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`

**Step 1: 实现功能**
- `section_inpage_label/desc` 改为【通用】语义（不改 section key，减少路由/测试波动）。
- 新增 `GeneralSection`：包含两张 card：
  - 页面内按钮：复用 `InpageSection` 仅渲染显示范围 select（下拉靠右）。
  - 自动保存：新增 card（heading + checkbox + hint）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git commit -m "feat: task4 - 设置页改为通用并拆分按钮与自动保存"`

---

## P2-T2 浏览器右键菜单加入快捷设置

**Files:**
- Modify: `webclipper/wxt.config.ts`（新增 `contextMenus` 权限）
- Modify: `webclipper/src/entrypoints/background.ts`
- Add: `webclipper/src/platform/context-menus/clipper-context-menu.ts`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`
- Modify: `webclipper/AGENTS.md`（补充“右键菜单快捷入口”）
- Modify: `.github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`

**Step 1: 实现功能**
- background 启动时注册 context menu：
  - 显示范围：`supported/all/off`（radio）
  - 自动保存：`ai_chat_auto_save_enabled`（checkbox）
- 点击后写入 `chrome.storage.local` 同名键。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git commit -m "feat: task5 - 右键菜单提供inpage与自动保存快捷开关"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Flow:
  1. 记录发现
  2. 修复
  3. 运行 `npm --prefix webclipper run compile` / `test` / `build`
