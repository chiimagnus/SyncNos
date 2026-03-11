# Plan P3 - webclipper-ui-design-system-refactor

**Goal:** 将 Conversations（list/detail/header/notice/bubble）全链路视觉与交互态迁移到设计系统 tokens，并在 phase 末尾彻底清理 legacy tokens 与 hard-coded 颜色，完成“规范闭环”。

**Non-goals:**
- 不重写 Conversations 的数据流、选择逻辑或 sync 逻辑（只动 UI 视觉与状态色表达）。
- 不新增任何 i18n 字段与文案（只换样式）。

**Approach:** 先统一容器 surface，再逐块替换 list/detail/header/notice/bubble 的颜色与交互态；最后用 `rg` 做守门检查，确保 UI 代码只使用设计系统 tokens。

**Acceptance:**
- Conversations 相关 TSX 不再包含硬编码 hex 颜色（允许 `AGENTS.md` / `example.html` 保留）。
- `webclipper/src/ui/**` 不再引用 legacy tokens（`--text --muted --bg --panel --btn-bg --danger --wc-ok*` 等）。
- 代码通过 `npm --prefix webclipper run compile` + `npm --prefix webclipper run test` + `npm --prefix webclipper run build`。

---

## P3-T1 ConversationsScene 容器层级与 Surface 统一

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationsScene.tsx`
- Modify: `webclipper/src/ui/conversations/conversations-context.tsx`

**Step 1: 实现功能**
- Conversations 根容器使用 `bg-primary/text-primary`。
- list/detail 容器按 `bg-sunken/bg-card` 分层，统一 border/focus ring 样式。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationsScene.tsx webclipper/src/ui/conversations/conversations-context.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task15 - ConversationsScene 统一 surface 层级"`

---

## P3-T2 ConversationListPane 列表与控制条样式重构

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`

**Step 1: 实现功能**
- 列表项 default/hover/active/selected 状态使用 tokens：
  - hover：surface 提升（`bg-card`）+ `text-primary`
  - active/selected：优先使用 `accent` 作为高亮（或用 accent 细条），文字用 `accent-foreground`
- 将 `--wc-ok*`（如今日计数）迁移到 `--success`（及 alpha/foreground 派生）。
- 将 warn badge 从 `--warn-bg`/旧 tokens 迁移到 `--warning` 语义色（或其更克制的背景派生）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationListPane.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task16 - ConversationListPane 迁移 tokens"`

---

## P3-T3 ConversationDetailPane 详情页样式重构

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationDetailPane.tsx`
- Modify: `webclipper/src/ui/shared/ChatMessageBubble.tsx`

**Step 1: 实现功能**
- Detail pane 的 panel/background/border/text 迁移到 tokens（不要再使用 `bg-white/80`、`#fffaf7` 等硬编码）。
- 错误提示颜色从 `--danger` 迁移到 `--error`（及 foreground）。
- `ChatMessageBubble`：
  - bubble 背景使用 surface tokens（建议：assistant=bg-card，user=accent 或 bg-sunken，根据现有信息密度选择）
  - link 色改为 `--info`（或更克制的 link token 派生），不要硬编码 `#2563eb`。
  - blockquote/inline code 等弱提示色使用 `text-secondary` 与 `border` 的 alpha 派生。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationDetailPane.tsx webclipper/src/ui/shared/ChatMessageBubble.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task17 - DetailPane/MessageBubble 迁移 tokens"`

---

## P3-T4 Detail header（actions/nav）菜单与按钮样式重构

**Files:**
- Modify: `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- Modify: `webclipper/src/ui/conversations/DetailNavigationHeader.tsx`

**Step 1: 实现功能**
- Header 背景/分割线使用 `bg-card/border`；菜单 popover 使用 `bg-card` + `border` +（亮色 shadow / 暗色微光边）。
- 所有按钮/菜单项的 hover/active/focus 使用 shared styles（若当前实现内联样式/重复，统一收敛到 shared helper）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/DetailHeaderActionBar.tsx webclipper/src/ui/conversations/DetailNavigationHeader.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task18 - Detail header/actions 菜单迁移 tokens"`

---

## P3-T5 语义状态色（Notice/Badge/Bubble）全面替换

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
- Modify: `webclipper/src/ui/conversations/ConversationDetailPane.tsx`
- Modify: `webclipper/src/ui/popup/PopupShell.tsx`

**Step 1: 实现功能**
- 将 Notice/Badge 中的硬编码颜色（hex）替换为 `--success/--warning/--error/--info`（及 foreground / alpha 派生）。
- 约束：同一语义在 popup/app/settings/inpage 表达一致（例如 success 永远用 success token）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx webclipper/src/ui/conversations/ConversationDetailPane.tsx webclipper/src/ui/popup/PopupShell.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task19 - 语义状态色统一到 tokens"`

---

## P3-T6 清理 legacy tokens/硬编码色值 + 文档同步

**Files:**
- Modify: `webclipper/src/ui/styles/tokens.css`
- Modify: `webclipper/AGENTS.md`

**Step 1: 清理**
- 在确认所有 UI 代码已迁移后，移除 `tokens.css` 中的 legacy alias（`--text --muted --bg --panel --btn-bg --danger --wc-ok* ...`）。
- 将剩余的少量硬编码 hex（TSX/CSS）替换为 tokens（允许保留在 `webclipper/src/ui/AGENTS.md` 与 `webclipper/src/ui/example.html`）。

**Step 2: 文档同步**
- 在 `webclipper/AGENTS.md` 中补充/更新“UI 设计系统入口”：`webclipper/src/ui/AGENTS.md`（作为 UI tokens 的单一真源）。

**Step 3: 验证（快速）**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/styles/tokens.css webclipper/AGENTS.md .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task20 - 清理 legacy tokens 并同步文档"`

---

## P3-T7 Phase 验证（compile/test/build + grep 守门）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: 守门检查**
- Legacy tokens usage 应为 0：
  - Run: `rg -n "var\\(--(text|muted|bg|panel|panel-strong|btn-bg|btn-bg-hover|border-strong|shadow|theme|danger|danger-bg|warn-bg|wc-ok)\\)" webclipper/src/ui --glob '!**/*.md' --glob '!**/*.html'`
- TS/TSX 硬编码 hex usage 应为 0（允许 docs/html）：
  - Run: `rg -n "#[0-9a-fA-F]{3,8}" webclipper/src/ui --glob '!**/*.md' --glob '!**/*.html'`

**Step 2: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 3: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task21 - P3 验证通过（tokens 清理完成）"`

---

## Phase Audit

- Audit file: `audit-p3.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
