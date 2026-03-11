# Plan P2 - webclipper-ui-design-system-refactor

**Goal:** 将 App / Popup / Settings 三大 UI 容器与表单类页面全面迁移到设计系统 tokens，并补齐语义状态色与暗色模式下的可读性。

**Non-goals:**
- 不调整 Settings 的信息架构与路由（只做视觉与交互态一致性）。
- 不修改任何 i18n 字段与文案（仅 className/CSS 迁移）。
- 不引入新的 UI 组件库（沿用当前 Tailwind + CSS variables 体系）。

**Approach:** 先处理“壳层（shell）+ 布局容器”，再处理“Settings 通用组件”，最后按 section 分批替换 hard-coded colors 与 legacy tokens usage；每个 task 通过 compile 可验证，phase 末尾跑 compile/test/build 并做亮/暗模式冒烟。

**Acceptance:**
- AppShell/PopupShell/SettingsScene 的背景、面板、边框、文字全部来自 tokens（surface 四级：sunken→primary→card→overlay）。
- Settings 的输入框、checkbox/radio、按钮 hover/active/disabled/focus 状态与规范一致。
- 代码通过 `npm --prefix webclipper run compile` + `npm --prefix webclipper run test` + `npm --prefix webclipper run build`。

---

## P2-T1 AppShell / App routes 适配四级 Surface

**Files:**
- Modify: `webclipper/src/ui/app/AppShell.tsx`
- Modify: `webclipper/src/ui/app/routes/Settings.tsx`
- Modify: `webclipper/src/ui/app/conversations/CapturedListSidebar.tsx`

**Step 1: 实现功能**
- App 根容器统一使用 `bg-primary/text-primary`。
- Sidebar/二级面板优先用 `bg-sunken`；卡片/对话框用 `bg-card`；overlay 遮罩使用 `bg-overlay`。
- 移除/替换对 `--bg/--panel/--panel-strong/--shadow` 的直接依赖（迁移到新 tokens）。
- 暗色模式下：阴影不可见处用“微光边框”或 surface 梯度表达层级（参考 `webclipper/src/ui/AGENTS.md` B4）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/app/AppShell.tsx webclipper/src/ui/app/routes/Settings.tsx webclipper/src/ui/app/conversations/CapturedListSidebar.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task8 - AppShell 适配四级 surface"`

---

## P2-T2 PopupShell / Popup tabs 适配四级 Surface

**Files:**
- Modify: `webclipper/src/ui/popup/PopupShell.tsx`
- Modify: `webclipper/src/ui/popup/tabs/ChatsTab.tsx`
- Modify: `webclipper/src/ui/popup/tabs/SettingsTab.tsx`

**Step 1: 实现功能**
- Popup 根容器使用 `bg-primary/text-primary`；主要内容容器使用 `bg-card` 或 `bg-sunken` 分层。
- 将 Popup 内硬编码的成功/失败颜色（hex）替换为 `--success/--error`（及 foreground / alpha 派生），保持语义一致。
- 保证 focus ring 对键盘用户可见（使用 `--focus-ring`）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/popup/PopupShell.tsx webclipper/src/ui/popup/tabs/ChatsTab.tsx webclipper/src/ui/popup/tabs/SettingsTab.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task9 - PopupShell 适配 tokens 与语义色"`

---

## P2-T3 Settings Scene/Sidebar 适配 tokens

**Files:**
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `webclipper/src/ui/settings/SettingsSidebarNav.tsx`

**Step 1: 实现功能**
- Settings 容器层级：背景 `bg-primary`，侧栏 `bg-sunken`，主面板 `bg-card`。
- Sidebar item 的 default/hover/active 状态改为：
  - default：`text-secondary`
  - hover：提升到 `text-primary`，背景用 `bg-card`
  - active：允许使用 `accent` 作为高亮（文字用 `accent-foreground`），或使用更克制的强调条（根据现有 UI 密度选择）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/SettingsScene.tsx webclipper/src/ui/settings/SettingsSidebarNav.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task10 - Settings Scene/Sidebar 适配 tokens"`

---

## P2-T4 Settings 通用表单组件（FormRow 等）适配 tokens

**Files:**
- Modify: `webclipper/src/ui/settings/sections/SettingsFormRow.tsx`
- Modify: `webclipper/src/ui/settings/ui.ts`
- Modify: `webclipper/src/ui/settings/utils.ts`

**Step 1: 实现功能**
- 将 label/description 的颜色从 `--muted/--text` 迁移到 `--text-secondary/--text-primary`。
- 输入框/按钮/分隔线统一使用 `--border` 与 surface tokens。
- checkbox/radio 的 `accent-color` 使用 `--accent`（符合“品牌色用于交互主强调”的预期），并确保暗色模式可读。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/sections/SettingsFormRow.tsx webclipper/src/ui/settings/ui.ts webclipper/src/ui/settings/utils.ts .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task11 - Settings 通用表单组件迁移 tokens"`

---

## P2-T5 Settings 表单型 sections 适配 tokens

**Files:**
- Modify: `webclipper/src/ui/settings/sections/InpageSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/ChatWithAiSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/NotionAISection.tsx`
- Modify: `webclipper/src/ui/settings/sections/NotionOAuthSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/ObsidianSettingsSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/BackupSection.tsx`

**Step 1: 实现功能**
- 将这些 sections 中的背景白色/半透明白、border 颜色与文字颜色统一迁移到 tokens。
- 移除对 `--btn-bg/--btn-bg-hover/--panel-strong/--border-strong` 的直接依赖（全部改为新 tokens）。
- 保证 hover/active/disabled/focus 状态符合 `webclipper/src/ui/AGENTS.md` B2 的派生规则。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/sections/InpageSection.tsx webclipper/src/ui/settings/sections/ChatWithAiSection.tsx webclipper/src/ui/settings/sections/NotionAISection.tsx webclipper/src/ui/settings/sections/NotionOAuthSection.tsx webclipper/src/ui/settings/sections/ObsidianSettingsSection.tsx webclipper/src/ui/settings/sections/BackupSection.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task12 - Settings 表单型 sections 迁移 tokens"`

---

## P2-T6 About/Insight sections 适配 tokens

**Files:**
- Modify: `webclipper/src/ui/settings/sections/AboutSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/InsightSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- Modify: `webclipper/src/ui/settings/sections/insight-stats.ts`

**Step 1: 实现功能**
- 标题/副标题/说明文字统一迁移到 `text-primary/text-secondary`。
- 图表与统计的强调色：
  - 关键数字可以用 `accent/secondary/info`（但避免全屏多处大面积 accent）。
  - placeholder/empty state 使用 `text-secondary`。
- 移除 Insight 内对旧 tokens（如 `--btn-bg-hover`）的直接依赖。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/sections/AboutSection.tsx webclipper/src/ui/settings/sections/InsightSection.tsx webclipper/src/ui/settings/sections/InsightPanel.tsx webclipper/src/ui/settings/sections/insight-stats.ts .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task13 - About/Insight sections 迁移 tokens"`

---

## P2-T7 Phase 验证（compile/test/build + light/dark 冒烟）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`
- Manual smoke（建议）：
  - 在浏览器 DevTools 中分别模拟 `prefers-color-scheme: light` 与 `dark`；
  - 打开 popup → Settings / Chats、打开 app → Settings；
  - 检查输入框、按钮、checkbox 的 hover/active/disabled/focus 状态是否符合规范。

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task14 - P2 验证通过（compile/test/build）"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
