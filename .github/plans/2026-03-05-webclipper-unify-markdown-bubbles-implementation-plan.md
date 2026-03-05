# WebClipper Popup/App 完全统一 Chats/Settings（响应式 + 两入口）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

> 说明：本计划分两阶段。
> - **P1（已完成）**：先把“消息气泡 + Markdown 渲染”彻底统一（已落地）。
> - **P2（本次深化）**：把 **Chats + Settings 整体 UI/行为** 统一到 **同一套代码**，popup 与 app 仅剩两个入口壳层；并为 **窄屏** 做 iOS push 单栏导航。

**Goal（目标）:**
- 让 WebClipper 的 `popup 面板` 与 `app 路由` 在 **Chats + Settings** 上使用 **同一套** UI 组件与状态逻辑（不再分别维护两份 ChatsTab/SettingsTab 实现）。
- 响应式：使用 Tailwind 默认断点 `md=768px`。
  - `>= md`：保持 app 现有“双栏 master-detail”观感（侧边栏 + 主视图），Settings 维持双栏导航。
  - `< md`：Chats 与 Settings 都使用 **iOS push 单栏导航**（列表 -> 详情 -> 返回）。
- popup 仍保留顶部 `Chats / Settings / About` tabs 导航；但 Chats/Settings tab 内部内容完全复用 app 同一套实现。
- Markdown 行为完全一致：`openLinksInNewTab=true`（链接统一新开 tab，并带 `rel=noreferrer noopener`）。
- 视觉统一为 popup 的气泡风格：`user` 为绿色气泡。
- Chats/Settings/气泡/Markdown 相关样式不再依赖旧的自定义 CSS 选择器块，改为 Tailwind utilities（含任意选择器 variants，如 `[&>p]:...`）。

**Non-goals（非目标）:**
- 不变更数据结构、存储协议、同步逻辑（仅重构 UI 组织与样式实现）。
- 不改动任何国际化字段（除非后续明确要求）。
- About tab 是否迁移到 Tailwind 不作为阻断项（可做但不强制）。

**Approach（方案）:**
- P1：抽共享组件 `ChatMessageBubble`（已完成）。
- P2：抽共享“场景组件（Scene）”，把 **Conversations(Chats)** 与 **Settings** 拆成：
  - 共享状态层：复用现有 `ConversationsProvider`，并将 popup 原 ChatsTab 逻辑迁移/对齐到该 provider（行为统一、只改一处）。
  - 共享视图层：创建 `ConversationsScene` / `SettingsScene`，内部根据断点决定 wide/narrow 布局。
  - 两个入口仅保留壳差异：
    - app：保留 AppShell 的整体“侧边栏+主视图”框架，并在 `<md` 时自动降级为单栏 push。
    - popup：保留 tabs，但 Chats/Settings tab 直接渲染共享 scene。
- 迁移策略：优先统一 **行为与数据流**（provider/handlers），再统一 **布局与样式**（Tailwind）。

**Acceptance（验收）:**
P1（已完成）：
1. Popup 预览消息与 App Conversations 详情消息，渲染结果一致：标题/角色行、气泡背景、Markdown 排版（p/h*/ul/ol/blockquote/code/pre/table/a）一致。
2. 任意 Markdown 链接在 popup 与 app 中点击均新开 tab：HTML 包含 `target="_blank"` 且 `rel` 包含 `noreferrer noopener`。
3. 删除（或不再使用）旧的 markdown 相关 CSS 规则块：
   - `entrypoints/app/style.css` 中 `.wcMarkdown ...`
   - `src/ui/styles/popup.css` 中 `.chatPreviewMsgMarkdown ...`（以及其 user/role 颜色覆盖）

P2（本次深化必须满足）：
4. Chats 行为完全一致（popup 与 app）：
   - 列表筛选、选择/全选、导出、同步、删除行为一致（同一份状态/逻辑实现）。
   - `< md`：iOS push 单栏导航（列表 -> 详情 -> 返回），popup 与 app 都一致。
   - `>= md`：app 维持侧边栏 + 主视图；popup 因宽度通常 `<md`，但同一套代码在宽度足够时也能正确渲染 wide 布局。
5. Settings 行为完全一致（popup 与 app）：
   - `>= md`：Settings 双栏导航（左侧 section list + 右侧内容）。
   - `< md`：iOS push 单栏（section 列表 -> section 详情 -> 返回）。
6. 样式一致（至少 Chats + Settings + Markdown 气泡相关）：
   - 组件样式使用 Tailwind utilities，不再依赖 popup/app 两套独立 class 选择器块。
7. `Extensions/WebClipper` 下编译、测试、打包校验通过：
   - `npm run compile`
   - `npm test`
   - `npm run build`
   - `npm run check`

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

---

## P2（深化重构）：Chats + Settings 完全复用同一套代码（响应式）

### Task 7: 建立响应式基础设施（md=768）

**Goal:**
- 在共享层提供 `isNarrow`（`< md`）的可靠判定，且能响应窗口尺寸变化。

**Files:**
- Create: `Extensions/WebClipper/src/ui/shared/hooks/useIsNarrowScreen.ts`

**Acceptance:**
- 在 app 与 popup 中都可复用；无需重复写 `matchMedia`。

**Validation:**
- `cd Extensions/WebClipper && npm run compile`

---

### Task 8: Conversations（Chats）抽成共享 Scene（含 iOS push）

**Goal:**
- Chats 只保留一套 UI/行为实现：列表 + 详情 + 操作栏 + iOS push（窄屏）。

**Files (expected):**
- Create: `Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx`
- Create: `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx`
- Create: `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx`
- Refactor: `Extensions/WebClipper/src/ui/app/AppShell.tsx`（接入共享 Scene；`<md` 时不渲染双栏）
- Refactor: `Extensions/WebClipper/src/ui/app/conversations/CapturedListSidebar.tsx`（拆壳：只保留 app 专属的 sidebar chrome；主体移到 `ConversationListPane`）
- Refactor: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`（迁移为 `ConversationDetailPane` 或薄 wrapper）
- Delete/Replace: `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`（改为复用 `ConversationsScene`，移除 popup 自己的 repo/状态实现）

**Behavior notes:**
- `< md`：默认停在列表；点击某条会进入详情（push）；详情顶部有返回按钮回列表。
- `>= md`：显示 master-detail；保持 app “侧边栏 + 主视图” 的观感。

**Validation:**
- `cd Extensions/WebClipper && npm run compile`
- `cd Extensions/WebClipper && npm test`

---

### Task 9: Settings 抽成共享 Scene（含 iOS push）

**Goal:**
- popup 与 app 的 Settings 使用同一套实现，并在 `< md` 自动切换为 iOS push。

**Files (expected):**
- Refactor: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
  - `>= md`：保持现有双栏导航
  - `< md`：新增“section 列表页”与“section 详情页”，并提供返回逻辑
- Refactor: `Extensions/WebClipper/src/ui/app/AppShell.tsx`
  - `>= md`：保留现有 settings modal sheet（背景不可交互 + 点击遮罩关闭 + Escape 关闭）
  - `< md`：不再使用 modal sheet，Settings 作为正常路由页面渲染（符合单栏 iOS push 预期）
- Delete/Replace: `Extensions/WebClipper/entrypoints/popup/tabs/SettingsTab.tsx`（改为复用 app 的 Settings）

**Validation:**
- `cd Extensions/WebClipper && npm run compile`
- `cd Extensions/WebClipper && npm test`

---

### Task 10: Popup 完全重构为复用 app Scene（保留 tabs）

**Goal:**
- popup 仍是 `Chats / Settings / About` tabs，但 Chats/Settings 不再有自己的实现与样式体系。
- popup 宽度/高度约束仍然可用（窄屏自然进入 iOS push）。

**Files (expected):**
- Refactor: `Extensions/WebClipper/entrypoints/popup/App.tsx`
  - tabs UI 逐步迁移为 Tailwind utilities（减少/移除对 `popup.css` 的依赖）
  - Chats tab: render shared `ConversationsScene`
  - Settings tab: render shared Settings（refactor 后）
- Optional: `Extensions/WebClipper/entrypoints/popup/style.css` 仅保留最小尺寸约束（其余转 Tailwind）
- Cleanup: `Extensions/WebClipper/src/ui/styles/popup.css` 移除 Chats/Settings 相关的遗留样式（仅保留仍被 About 或其它区域使用的样式，或将其也迁移）

**Validation:**
- `cd Extensions/WebClipper && npm run compile`
- `cd Extensions/WebClipper && npm run build`
- `cd Extensions/WebClipper && npm run check`

---

### Task 11: 人工 UI 验收（必须）

Run: `cd Extensions/WebClipper && npm run dev`

Check:
- Popup（窄屏）：
  - Chats：列表 -> 详情 -> 返回（iOS push），行为与 app `<md` 一致
  - Settings：section 列表 -> section 详情 -> 返回（iOS push）
- App（可调窄浏览器窗口验证 `<md`）：
  - Chats：同样单栏 push
  - Settings：同样单栏 push
- App（宽屏）：
  - Chats：侧边栏 + 主视图
  - Settings：双栏导航
