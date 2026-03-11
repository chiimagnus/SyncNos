# Plan P1 - webclipper-ui-design-system-refactor

**Goal:** 将 WebClipper UI 的色彩体系从“暖色主导”迁移为 `webclipper/src/ui/AGENTS.md` 定义的“冷灰底座 + 暖桃点缀”，并打通 `prefers-color-scheme` 的亮/暗模式基础能力。

**Non-goals:**
- 不改任何业务逻辑与交互流程（仅改样式与 tokens 绑定）。
- 不新增手动主题切换开关（跟随系统 `prefers-color-scheme`）。
- 未被明确要求时，不改任何 i18n 字段与文案内容（只调整 className/CSS）。

**Approach:** 以 `webclipper/src/ui/AGENTS.md` 为单一真源，将 tokens 落地到 `webclipper/src/ui/styles/tokens.css`，并在迁移期保留 legacy tokens alias，分批替换 shared styles 与 inpage CSS，保证每个 task 都可编译验证与独立提交。

**Acceptance:**
- `webclipper/src/ui/styles/tokens.css` 含完整亮/暗 tokens（含 on-color、hover/active、focus ring），并通过 `prefers-color-scheme` 自动切换。
- shared 样式（按钮、导航、焦点态、inpage）不再依赖“正文橙色”作为主文本色。
- 代码通过 `npm --prefix webclipper run compile`。

---

## P1-T1 设计系统 tokens（亮/暗模式）

**Files:**
- Modify: `webclipper/src/ui/styles/tokens.css`

**Step 1: 实现功能**
- 按 `webclipper/src/ui/AGENTS.md` 的 Part B1/B2 落地以下 tokens（Light + Dark）：
  - Surface: `--bg-primary --bg-sunken --bg-card --bg-overlay`
  - Text: `--text-primary --text-secondary`
  - Brand + On-Color: `--accent --accent-foreground --accent-hover --accent-active --secondary --secondary-foreground --tertiary --tertiary-foreground`
  - Semantic + On-Color: `--error --error-foreground --warning --warning-foreground --success --success-foreground --info --info-foreground`
  - Utility: `--border --focus-ring`
- Dark mode 使用 `@media (prefers-color-scheme: dark) { :root { ... } }` 自动切换。
- 允许原生控件跟随系统渲染：在 `:root` 设置 `color-scheme: light dark`（或等价实现）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript compile 通过（不要求本 task 替换任何 usage）。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/styles/tokens.css .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task1 - 引入设计系统tokens（亮暗模式）"`

---

## P1-T2 Legacy tokens 兼容层（迁移期）

**Files:**
- Modify: `webclipper/src/ui/styles/tokens.css`

**Step 1: 实现功能**
- 在 `tokens.css` 末尾增加“legacy alias”（仅迁移期使用，P3 会删除）：
  - `--text -> --text-primary`
  - `--muted -> --text-secondary`
  - `--bg -> --bg-primary`
  - `--panel/--panel-strong/--btn-bg/--btn-bg-hover/--shadow/--border-strong` 以最小破坏方式映射到新体系（优先用 surface + border + accent 派生）。
  - `--danger/--danger-bg/--warn-bg/--wc-ok*` 映射到 `--error/--warning/--success` 语义色（并补齐必要的 bg/alpha 派生）。
- 要求：新 tokens 为主、legacy alias 不引入新色值（只引用新 tokens 或其 alpha/派生）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: compile 通过。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/styles/tokens.css .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task2 - 为旧 tokens 增加迁移期 alias"`

---

## P1-T3 入口全局样式改为冷灰底座

**Files:**
- Modify: `webclipper/src/entrypoints/app/style.css`
- Modify: `webclipper/src/entrypoints/popup/style.css`

**Step 1: 实现功能**
- `app/style.css`：
  - 背景由暖色渐变改为冷灰底座（允许“微渐变”策略，参考 `webclipper/src/ui/AGENTS.md` A7）。
  - `body` 的 `color` 绑定到 `var(--text-primary)`，背景绑定到 `var(--bg-primary)`（以及可选的 `--gradient-start/--gradient-end` 派生）。
- `popup/style.css`：
  - 移除强制 `color-scheme: light`（避免 OS dark mode 下表单控件仍强制亮色）。
  - 让 popup 最外层至少具备 `bg-primary/text-primary` 的默认基调（即使各组件没有显式设置）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/entrypoints/app/style.css webclipper/src/entrypoints/popup/style.css .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task3 - 入口样式切换为冷灰底座"`

---

## P1-T4 按钮与焦点态（focus-ring）规范化

**Files:**
- Modify: `webclipper/src/ui/shared/button-styles.ts`

**Step 1: 实现功能**
- 将 primary/secondary/destructive 三类按钮样式改为使用设计系统 tokens：
  - Primary: `--accent` / `--accent-hover` / `--accent-active` + `--accent-foreground`
  - Destructive: `--error` + `--error-foreground`（或 error-bg 派生）
  - Outline/Secondary: surface + border + text tokens
- Focus ring：统一为 `2px outline + 2px offset`，颜色为 `var(--focus-ring)`（参考 `webclipper/src/ui/AGENTS.md` A4/A5）。
- Disabled：统一使用 `0.38` 透明度规则（不要再用随意的 `opacity-80`）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/shared/button-styles.ts .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task4 - 统一按钮与 focus ring tokens"`

---

## P1-T5 导航与 Tab 交互态规范化

**Files:**
- Modify: `webclipper/src/ui/shared/nav-styles.ts`

**Step 1: 实现功能**
- 导航/Tab 的 default/hover/active/disabled/focus 样式全部改为 tokens（surface + text + accent + focus-ring）。
- Active 状态不要再依赖 `--text` 作为“强调色文字”，以 `--accent` 作为强调背景/标记，文字使用 `--accent-foreground`。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/shared/nav-styles.ts .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task5 - 统一导航与 tab 交互态 tokens"`

---

## P1-T6 Inpage UI 样式接入 tokens

**Files:**
- Modify: `webclipper/src/ui/styles/inpage-button.css`
- Modify: `webclipper/src/ui/styles/inpage-tip.css`

**Step 1: 实现功能**
- `inpage-button.css`：
  - focus-visible 改为 `var(--focus-ring)`（带 fallback），并符合 `2px outline + 2px offset`。
  - 其它视觉保持克制（不引入大面积 accent）。
- `inpage-tip.css`：
  - loading/error 的色彩从硬编码值迁移到 `--warning/--error`（及其 foreground / alpha 派生），保证对比度可读。
  - 避免直接硬编码 hex（除非作为 fallback）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/styles/inpage-button.css webclipper/src/ui/styles/inpage-tip.css .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "refactor: task6 - inpage UI 样式接入 tokens"`

---

## P1-T7 Phase 验证（compile）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: compile 通过。
- Manual smoke（最小）：在浏览器里分别打开 popup 与 app（亮/暗模式各一次），确认：
  - 背景基调为冷灰底座，主文本为中性灰白（不再是橙色正文）。
  - focus ring 在可聚焦控件上可见且不刺眼。

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task7 - P1 验证通过（compile）"`

---

## Phase Audit

- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
