# Plan P1 - webclipper-inpage-visibility-and-ai-autosave

**Goal:** 增强 WebClipper 的 inpage 显示控制与 AI 聊天自动保存控制，降低“误以为自动保存普通网页”的用户困扰。

**Non-goals:**
- 不做按站点/按会话粒度开关。
- 不为普通网页（非已适配 AI 聊天站点）引入自动保存。

**Approach:** 用 `chrome.storage.local` 新增两类设置：inpage 显示三态（兼容旧 `inpage_supported_only`）与 AI 聊天自动保存总开关。content script 继续全站匹配，但运行时决定是否启动 controller；自动保存逻辑只对 chat collectors 生效。

**Acceptance:**
- `inpage_display_mode` 支持 `supported/all/off`，并兼容 `inpage_supported_only`。
- `ai_chat_auto_save_enabled=false` 时不再自动保存聊天增量，但手动保存仍可用。
- 代码通过 `npm --prefix webclipper run compile`。

---

## P1-T1 Inpage 显示三态（兼容旧设置）

**Files:**
- Modify: `webclipper/src/bootstrap/content.ts`
- Modify: `webclipper/src/entrypoints/content.ts`
- Modify: `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `webclipper/src/ui/settings/sections/InpageSection.tsx`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`

**Step 1: 实现功能**
- 新增 `inpage_display_mode`（`supported|all|off`），读取优先于旧 `inpage_supported_only`。
- content bootstrap 在支持站点也需要读取该枚举，以支持 `off`（全局隐藏）。
- Settings UI 将旧的 checkbox 改为 select/radio 的三态选择，并写入 `inpage_display_mode`。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript compile 通过。

**Step 3: 原子提交**
- Run: `git add webclipper/src/bootstrap/content.ts webclipper/src/entrypoints/content.ts webclipper/src/ui/settings/hooks/useSettingsSceneController.ts webclipper/src/ui/settings/SettingsScene.tsx webclipper/src/ui/settings/sections/InpageSection.tsx webclipper/src/i18n/locales/en.ts webclipper/src/i18n/locales/zh.ts .github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`
- Run: `git commit -m "feat: task1 - Inpage 显示三态设置（兼容旧开关）"`

---

## P1-T2 AI 聊天自动保存总开关（仅 chat collectors）

**Files:**
- Modify: `webclipper/src/bootstrap/content-controller.ts`
- Modify: `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `webclipper/src/ui/settings/sections/InpageSection.tsx`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`

**Step 1: 实现功能**
- 新增 `ai_chat_auto_save_enabled`（默认 `true`）。
- content controller 在 onTick 中读取该开关（允许“刷新后生效”的最简单模型），关闭时跳过自动保存，但保留 inpage 按钮与手动保存。
- 自动保存仅对 chat collectors 生效（白名单 `chatgpt/claude/gemini/deepseek/kimi/doubao/yuanbao/poe/notionai/zai`）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript compile 通过。

**Step 3: 原子提交**
- Run: `git add webclipper/src/bootstrap/content-controller.ts webclipper/src/ui/settings/hooks/useSettingsSceneController.ts webclipper/src/ui/settings/SettingsScene.tsx webclipper/src/ui/settings/sections/InpageSection.tsx webclipper/src/i18n/locales/en.ts webclipper/src/i18n/locales/zh.ts .github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`
- Run: `git commit -m "feat: task2 - 增加AI聊天自动保存总开关"`

---

## P1-T3 文档同步 + Phase 验证

**Files:**
- Modify: `webclipper/AGENTS.md`

**Step 1: 文档同步**
- 更新 inpage 显示范围设置描述：从 `inpage_supported_only` 迁移为 `inpage_display_mode`，并说明兼容规则与刷新生效约束。
- 补充 `ai_chat_auto_save_enabled` 的行为说明（仅 chat collectors，默认开启，可关闭）。

**Step 2: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`
- Expected: 三个命令均通过。

**Step 3: 原子提交**
- Run: `git add webclipper/AGENTS.md .github/features/webclipper-inpage-visibility-and-ai-autosave/todo.toml`
- Run: `git commit -m "docs: task3 - 同步inpage与自动保存设置文档"`

---

## Phase Audit

- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
