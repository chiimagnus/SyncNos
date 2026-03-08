# Plan P1 - webclipper-detail-open-destinations

**Goal:** 用协议驱动方式为 WebClipper 的 detail header 建立可扩展的打开目标入口，并在 popup 与 app 两端先落地 `Open in Notion`。

**Non-goals:** 本 phase 不实现 Obsidian 入口、不实现下拉菜单、不实现 `Chat with xx AI`、不调整列表页动作区、不编辑国际化字段。

**Approach:** 先把“右上角动作”从 `PopupShell` / `AppShell` 的具体按钮实现中抽离为共享协议，再由会话详情层根据 `selectedConversation` 解析出可用目标。P1 只接入 Notion，一个会话有 `notionPageId` 才显示入口，没有则完全隐藏。Notion 页面 URL 拼装与外部打开逻辑必须收敛到单一 helper / port，UI 层只消费协议结果，避免 popup 和 app 各自拼 URL。可见文案先使用 feature 内常量，不触碰 i18n 资源文件。

**Acceptance:**
- popup detail header 右上角在会话存在 `notionPageId` 时显示 `Open in Notion`，否则不显示占位。
- app detail header 在同样条件下显示相同行为，和 popup 使用同一套协议与 resolver。
- `PopupShell` 不再在 detail 模式里显示占位的 `More` 按钮。
- Notion URL 生成逻辑只有一个真源，shell 组件不直接拼接 `notion.so` 链接。
- `npm --prefix Extensions/WebClipper run compile`、目标 smoke tests、`npm --prefix Extensions/WebClipper run build` 通过。

---

## P1-T1 定义 detail header 打开目标协议与 Notion resolver

**Files:**
- Add: `Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`
- Modify: `Extensions/WebClipper/src/conversations/domain/models.ts`

**Step 1: 建立协议边界**

新增 detail header action 协议，至少显式建模这些概念：
- 动作描述：`id`、`label`、`kind`、`onTrigger` 或 `href`
- 动作集合：single / menu 之前统一先输出数组
- resolver 输入：当前 `selectedConversation`、必要的打开端口
- resolver 输出：仅包含当前 detail view 可见动作

协议层不要直接依赖 popup/app 组件，后续 Phase 2 要能在同一协议上扩展 Obsidian 和下拉菜单。

**Step 2: 收敛 Notion 目标解析**

在协议层或其相邻 helper 中收敛：
- `notionPageId` 判空与规范化
- Notion page URL 构造
- 外部打开调用端口

要求 popup/app 不自行拼装 URL，不在 JSX 内嵌条件分支判断 `notionPageId`。

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 新增协议类型与会话上下文字段后，TypeScript 无报错。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx Extensions/WebClipper/src/ui/conversations/conversations-context.tsx Extensions/WebClipper/src/conversations/domain/models.ts`

Run: `git commit -m "feat: task1 - 定义详情页打开目标协议与notion解析器"`

---

## P1-T2 接入 popup detail header 右上角 Open in Notion 入口

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/PopupShell.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx`
- Modify: `Extensions/WebClipper/src/ui/popup/tabs/ChatsTab.tsx`

**Step 1: 扩展 popup header contract**

让 `PopupHeaderState` 能承载 detail 模式右上角动作，而不是只承载标题、副标题、返回事件。header 组件只根据协议渲染按钮，不再写死 `More actions coming soon` 占位。

**Step 2: 保持 detail-only 约束**

入口必须只出现在 detail navigation title 的右上角：
- list 模式仍显示抓取与设置按钮
- detail 模式只显示返回、标题、副标题、协议动作
- 没有动作时不保留 disabled 占位

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-shell-header-actions.test.ts`

Expected: popup header smoke test 覆盖 list/detail 切换，以及 detail 模式下 `Open in Notion` 的显示与隐藏。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/popup/PopupShell.tsx Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx Extensions/WebClipper/src/ui/popup/tabs/ChatsTab.tsx Extensions/WebClipper/tests/smoke/popup-shell-header-actions.test.ts`

Run: `git commit -m "feat: task2 - 为popup详情头部接入notion打开入口"`

---

## P1-T3 接入 app detail header 右上角 Open in Notion 入口

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/AppShell.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`
- Add: `Extensions/WebClipper/src/ui/conversations/DetailHeaderActionBar.tsx`

**Step 1: 给 app detail header 建立共享动作位**

app 当前桌面宽屏视图直接渲染 `ConversationDetailPane`，没有 popup 那样的独立 header 状态机。P1 需要在不破坏现有 layout 的前提下，为 app detail header 建一个共享动作位组件，并复用与 popup 相同的 action 协议。

**Step 2: 保持 popup/app 行为一致**

app 与 popup 的差异只允许存在于布局容器，不允许存在于：
- `Open in Notion` 的可见性规则
- Notion URL 解析逻辑
- 打开外部页面的触发条件

如果 app 侧更适合把动作放进 `ConversationDetailPane` header，也必须复用同一套协议与按钮渲染组件。

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: app 侧新增 header 动作位后，popup/app 共用类型仍保持通过。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/app/AppShell.tsx Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx Extensions/WebClipper/src/ui/conversations/conversations-context.tsx Extensions/WebClipper/src/ui/conversations/DetailHeaderActionBar.tsx`

Run: `git commit -m "feat: task3 - 为app详情头部接入notion打开入口"`

---

## P1-T4 补齐 phase1 回归测试与文档同步

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/popup-shell-header-actions.test.ts`
- Add: `Extensions/WebClipper/tests/smoke/app-detail-header-actions.test.ts`
- Add: `Extensions/WebClipper/tests/smoke/detail-header-actions.test.ts`
- Modify: `Extensions/WebClipper/AGENTS.md`
- Modify: `.github/deepwiki/modules/webclipper.md`

**Step 1: 补齐协议与 UI 回归**

至少覆盖这些场景：
- 会话有 `notionPageId` 时输出 `Open in Notion`
- 会话无 `notionPageId` 时 detail header 无动作
- popup detail header 不再显示旧的 `More` 占位
- app detail header 与 popup 对同一会话给出相同动作

优先把 URL 构造与动作解析拆成可独立测试的纯函数，降低 UI 测试复杂度。

**Step 2: 同步文档**

在不触碰 i18n 的前提下，更新扩展文档入口，明确：
- detail header 右上角开始承载会话级打开目标动作
- Phase 1 当前仅包含 `Open in Notion`
- 后续多目标菜单由同一协议扩展

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-shell-header-actions.test.ts tests/smoke/app-detail-header-actions.test.ts tests/smoke/detail-header-actions.test.ts`

Run: `npm --prefix Extensions/WebClipper run build`

Expected: compile、目标 smoke tests、Chrome build 全部通过。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/tests/smoke/popup-shell-header-actions.test.ts Extensions/WebClipper/tests/smoke/app-detail-header-actions.test.ts Extensions/WebClipper/tests/smoke/detail-header-actions.test.ts Extensions/WebClipper/AGENTS.md .github/deepwiki/modules/webclipper.md`

Run: `git commit -m "test: task4 - 补齐notion打开入口回归与文档"`

---

## Phase Audit

- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录协议边界、UI 一致性、文档同步方面的发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
