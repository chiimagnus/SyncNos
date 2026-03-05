# WebClipper Popup/App 统一 Markdown 渲染与气泡样式 实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**
- 让 WebClipper 的 `popup 面板` 与 `app 路由` 使用同一套“消息气泡 + Markdown 渲染”代码与样式。
- Markdown 行为完全一致：`openLinksInNewTab=true`（链接统一新开 tab，并带 `rel=noreferrer noopener`）。
- 视觉统一为 popup 的气泡风格：`user` 为绿色气泡。
- Markdown/气泡相关样式不再依赖旧的自定义 CSS 选择器块，改为 Tailwind utilities（含任意选择器 variants，如 `[&>p]:...`）。

**Non-goals（非目标）:**
- 不在本计划中把整个 popup/app 所有 UI 都迁移到 Tailwind（仅覆盖“消息气泡 + Markdown 渲染”相关）。
- 不变更数据结构、存储协议、同步逻辑。
- 不改动任何国际化字段（除非后续明确要求）。

**Approach（方案）:**
- 抽一个共享组件（放在 `Extensions/WebClipper/src/ui/shared/`），把“role -> 气泡样式 + Markdown 渲染 + Markdown 子元素样式”封装成单一入口。
- `popup` 与 `app` 两个入口仅负责：拿到 message 数据，调用同一个组件渲染。
- 为避免未来再次分歧，统一由共享组件内部创建 markdown renderer（或将 `createMarkdownRenderer()` 默认行为改为 `openLinksInNewTab=true` 并保持单点使用）。

**Acceptance（验收）:**
1. Popup 预览消息与 App Conversations 详情消息，渲染结果一致：标题/角色行、气泡背景、Markdown 排版（p/h*/ul/ol/blockquote/code/pre/table/a）一致。
2. 任意 Markdown 链接在 popup 与 app 中点击均新开 tab：HTML 包含 `target="_blank"` 且 `rel` 包含 `noreferrer noopener`。
3. 删除（或不再使用）旧的 markdown 相关 CSS 规则块：
   - `entrypoints/app/style.css` 中 `.wcMarkdown ...`
   - `src/ui/styles/popup.css` 中 `.chatPreviewMsgMarkdown ...`（以及其 user/role 颜色覆盖）
4. `Extensions/WebClipper` 下编译、测试、打包校验通过：
   - `npm run compile`
   - `npm test`
   - `npm run build`（建议）

---

## P1（最高优先级）：建立共享组件并接入两入口

### Task 1: 冻结现状与对齐口径（只读确认）

**Files:**
- Read: `Extensions/WebClipper/src/ui/shared/markdown.ts`
- Read: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
- Read: `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
- Read: `Extensions/WebClipper/entrypoints/app/style.css`
- Read: `Extensions/WebClipper/src/ui/styles/popup.css`

**Step 1: 记录当前差异点**
- 行为差异：app 传 `openLinksInNewTab:true`，popup 未传。
- 样式差异：app 用 `.wcMarkdown ...`；popup 用 `.chatPreviewMsgMarkdown ...`，并有绿色 user 气泡覆盖。

**Step 2: 验证（无命令，检查点）**
- Expected: 已明确 P1 只迁移“消息气泡 + Markdown”，其余 popup/app 样式不动。

**Step 3:（可选）原子提交**
- 无需提交。

---

### Task 2: 新增共享组件：`ChatMessageBubble`（Tailwind-only）

**Files:**
- Create: `Extensions/WebClipper/src/ui/shared/ChatMessageBubble.tsx`
- Modify（如需）: `Extensions/WebClipper/src/ui/shared/markdown.ts`

**Step 1: 实现共享组件**
- 组件职责：
  - 输入：`role`（user/assistant/other），`title`（可选），`metaRight`（可选），`markdown`（string）。
  - 内部：创建 markdown renderer（固定 `openLinksInNewTab:true`），`md.render(markdown)`，并输出 `dangerouslySetInnerHTML`。
  - 样式：全部 Tailwind（prefix 为 `tw-`），包括：
    - 气泡容器（user 绿色，assistant 白色，other 淡色）
    - Markdown 子元素（table/p/h*/ul/ol/blockquote/code/pre/a）
  - 注意：使用 Tailwind arbitrary selector variants 代替 `.wcMarkdown` / `.chatPreviewMsgMarkdown` CSS。

- 行为：链接统一 `_blank` + `rel`。

**Step 2: 验证**
Run: `cd Extensions/WebClipper && npm run compile`
Expected: TypeScript 编译通过。

**Step 3:（可选）原子提交**
Run: `git add Extensions/WebClipper/src/ui/shared/ChatMessageBubble.tsx Extensions/WebClipper/src/ui/shared/markdown.ts`
Run: `git commit -m "feat: task2 - add shared chat bubble markdown renderer"`

---

### Task 3: App 路由接入共享组件并移除 `.wcMarkdown` 依赖

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
- Modify: `Extensions/WebClipper/entrypoints/app/style.css`

**Step 1: 接入**
- 将 `Conversations.tsx` 的消息渲染替换为 `<ChatMessageBubble ... />`。
- 确保 role 映射与 popup 一致（user 绿色）。
- 删除/不再使用 `wcMarkdown` wrapper class。

**Step 2: 清理 CSS**
- 从 `entrypoints/app/style.css` 删除 `.wcMarkdown ...` 规则块（以及只服务于该块的细碎样式）。
- 保留 Tailwind 指令与其它仍在使用的全局设置（不要在本任务里扩大迁移范围）。

**Step 3: 验证**
Run: `cd Extensions/WebClipper && npm run compile`
Expected: 编译通过。

**Step 4:（可选）原子提交**
Run: `git add Extensions/WebClipper/src/ui/app/routes/Conversations.tsx Extensions/WebClipper/entrypoints/app/style.css`
Run: `git commit -m "refactor: task3 - use shared chat bubble in app"`

---

### Task 4: Popup 预览接入共享组件并移除 `.chatPreviewMsgMarkdown` 依赖

**Files:**
- Modify: `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
- Modify: `Extensions/WebClipper/src/ui/styles/popup.css`

**Step 1: 接入**
- 将 popup 的 preview messages 渲染替换为 `<ChatMessageBubble ... />`。
- 移除 `createMarkdownRenderer()` 的本地 `useMemo`（由共享组件统一负责）。
- 统一行为：链接新开 tab。

**Step 2: 清理 CSS**
- 从 `src/ui/styles/popup.css` 删除 `.chatPreviewMsgMarkdown ...` 相关规则块（包含 user 气泡 markdown 颜色覆盖）。
- 若 `.chatPreviewMsg` / `.chatPreviewMsgRole` 仅用于该渲染区域，也同步迁移到 Tailwind 并删除对应规则（以实际使用为准，避免影响 popup 其它区域）。

**Step 3: 验证**
Run: `cd Extensions/WebClipper && npm run compile`
Expected: 编译通过。

**Step 4:（可选）原子提交**
Run: `git add Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx Extensions/WebClipper/src/ui/styles/popup.css`
Run: `git commit -m "refactor: task4 - use shared chat bubble in popup preview"`

---

### Task 5: 补一个最小测试锁定链接行为（防止回归）

**Files:**
- Create: `Extensions/WebClipper/src/ui/shared/markdown.test.ts`（或放在 `Extensions/WebClipper/tests/`，以项目现有测试组织为准）

**Step 1: 测试内容**
- 调用 `createMarkdownRenderer({ openLinksInNewTab: true })` 或通过共享组件的内部 helper。
- 输入：`[x](https://example.com)`
- 断言输出 HTML 包含：
  - `<a ... target="_blank" ...>`
  - `rel` 同时包含 `noreferrer` 与 `noopener`

**Step 2: 验证**
Run: `cd Extensions/WebClipper && npm test`
Expected: PASS。

**Step 3:（可选）原子提交**
Run: `git add Extensions/WebClipper/src/ui/shared/markdown.test.ts`
Run: `git commit -m "test: task5 - lock markdown link target behavior"`

---

### Task 6: 端到端验证（构建 + 人工 UI）

**Files:**
- None

**Step 1: 构建验证**
Run: `cd Extensions/WebClipper && npm run build`
Expected: build 成功。

**Step 2:（建议）打包一致性校验**
Run: `cd Extensions/WebClipper && npm run check`
Expected: check 通过。

**Step 3: 人工 UI 验证**
Run: `cd Extensions/WebClipper && npm run dev`
- 在浏览器打开扩展 popup：
  - user 消息为绿色气泡
  - Markdown table/code/pre/blockquote/a 等样式正确
  - 点击链接新开 tab
- 点击 popup Header 的 “Open App” 打开 app 路由：
  - 同样的消息展示与 popup 一致（气泡 + Markdown）
  - 点击链接新开 tab

**Step 4:（可选）回归提交**
- 如果前面按 task 提交，这里不需要额外提交。

---

## P2（可选，后续）：逐步把剩余 popup/app 的自定义 CSS 迁移到 Tailwind

> 仅在你确认要“彻底不用旧 CSS 文件”时执行。本计划不默认执行。

候选拆分方向（每块都应是独立小任务，并确保不影响其它 tab）：
- Popup：将 `popup.css` 中与 ChatsTab/SettingsTab/AboutTab 各自相关的样式，逐步迁移到对应 TSX 内的 Tailwind class。
- App：将 `entrypoints/app/style.css` 中剩余全局 CSS 逐步收敛到 `tokens.css` 或 TSX Tailwind class；最终仅保留 Tailwind 指令文件。

