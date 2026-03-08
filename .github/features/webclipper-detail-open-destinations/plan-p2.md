# Plan P2 - webclipper-detail-open-destinations

**Goal:** 在 P1 的协议基础上把 detail header 入口扩展为动态单按钮 / 下拉菜单，并接入 `Open in Obsidian`，满足单目标直出、双目标下拉的显示规则。

**Non-goals:** 本 phase 不实现 `Chat with ChatGPT`、`Chat with Notion AI` 或其他 AI handoff，不重做 popup/app 整体 header 样式，不编辑国际化字段。

**Approach:** 继续沿用 P1 的协议驱动边界，让 shell 只关心“当前有几个动作、每个动作怎么触发”，不感知 Notion / Obsidian 细节。Obsidian 侧需要单独建立 capability resolver：先利用现有 stable note path、当前连接配置和服务端状态判断是否能生成可打开目标；如果现有状态接口不足以提供稳定目标，就把补齐能力的变更限制在 Obsidian adapter / settings 层，避免把条件分支泄漏到 UI。最终规则固定为：只有 Notion 时直接按钮、只有 Obsidian 时直接按钮、两者都存在时显示下拉菜单。

**Acceptance:**
- 当前 detail 仅有 Notion 目标时，右上角显示单个 `Open in Notion` 按钮。
- 当前 detail 仅有 Obsidian 目标时，右上角显示单个 `Open in Obsidian` 按钮。
- 当前 detail 同时具备两个目标时，右上角显示一个下拉触发器，菜单内列出两个动作。
- popup 与 app 对同一会话给出一致的目标集合与同样的显示规则。
- Obsidian 目标解析逻辑有单一协议入口，不把 vault / note path 细节散落到 JSX。
- `npm --prefix Extensions/WebClipper run compile`、目标 smoke tests、`npm --prefix Extensions/WebClipper run build` 通过。

---

## P2-T1 定义 Obsidian 打开目标协议与 capability resolver

**Files:**
- Add: `Extensions/WebClipper/src/ui/conversations/detail-header-obsidian-target.ts`
- Modify: `Extensions/WebClipper/src/sync/obsidian/obsidian-services.ts`
- Modify: `Extensions/WebClipper/src/sync/obsidian/obsidian-local-rest-client.ts`
- Modify: `Extensions/WebClipper/src/sync/obsidian/obsidian-note-path.ts`
- Modify: `Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts`

**Step 1: 收敛 Obsidian 可打开目标的判断**

不要把 Obsidian 入口写成“只要配置过就显示”。resolver 至少要统一判断：
- 当前会话能否推导稳定 note path
- 当前 Obsidian 连接是否可用
- 当前服务端状态是否提供足够信息来构造可打开目标

如果 `getServerStatus()` 已经能给出稳定的 vault 元信息，就在 adapter 层读取并标准化；如果还不够，补充能力时也必须先进入 adapter / settings 协议，不允许 UI 直接探测配置细节。

**Step 2: 保持与 Notion resolver 平级**

Obsidian 目标需要和 P1 的 Notion resolver 一样，以协议形式输出：
- `available`
- `label`
- `target kind`
- `trigger payload`

不要在调用方用 `if (provider === 'obsidian')` 重新分发逻辑。

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-local-rest-client.test.ts tests/smoke/obsidian-sync-orchestrator.test.ts`

Expected: Obsidian adapter 相关 smoke tests 仍通过，且新增 capability 解析可被独立测试。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/detail-header-obsidian-target.ts Extensions/WebClipper/src/sync/obsidian/obsidian-services.ts Extensions/WebClipper/src/sync/obsidian/obsidian-local-rest-client.ts Extensions/WebClipper/src/sync/obsidian/obsidian-note-path.ts Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts`

Run: `git commit -m "feat: task1 - 定义obsidian打开目标协议与能力解析器"`

---

## P2-T2 将 detail header 入口升级为单按钮或下拉菜单

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx`
- Modify: `Extensions/WebClipper/src/ui/popup/PopupShell.tsx`
- Modify: `Extensions/WebClipper/src/ui/app/AppShell.tsx`

**Step 1: 把显示规则组件化**

共享动作条组件要显式支持三种状态：
- `0 actions`：不渲染
- `1 action`：直接按钮，显示该动作文案
- `2+ actions`：渲染菜单触发器与弹出菜单

不要在 popup/app 各自判断“什么时候该是按钮，什么时候该是菜单”。

**Step 2: 保持 detail navigation title 约束**

菜单触发器仍然只能出现在 detail navigation title 的右上角，不得回流到列表工具条，也不得影响返回按钮与标题布局。

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 动作条组件升级后，popup/app 头部类型与布局引用全部通过。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/DetailHeaderActionBar.tsx Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx Extensions/WebClipper/src/ui/popup/PopupShell.tsx Extensions/WebClipper/src/ui/app/AppShell.tsx`

Run: `git commit -m "feat: task2 - 将详情页打开入口升级为动态按钮或菜单"`

---

## P2-T3 接入 popup 与 app 的双目标显示规则

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx`
- Modify: `Extensions/WebClipper/src/ui/popup/tabs/ChatsTab.tsx`
- Modify: `Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts`

**Step 1: 统一目标集合解析**

会话详情层要能为同一会话解析出：
- 仅 Notion
- 仅 Obsidian
- Notion + Obsidian

同一个 resolver 结果同时喂给 popup 与 app，避免出现一端是按钮、另一端是菜单的漂移。

**Step 2: 固定显示规则**

规则必须写成共享纯逻辑，并在测试中锁住：
- `actions.length === 1` 直接显示对应 provider label
- `actions.length >= 2` 显示菜单
- 当前 phase 只允许 Notion / Obsidian 两类 destination action，AI handoff 留给后续 feature

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-shell-header-actions.test.ts tests/smoke/app-detail-header-actions.test.ts tests/smoke/detail-header-actions.test.ts`

Expected: popup/app 在三种目标集合下都给出一致渲染结果。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/conversations-context.tsx Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx Extensions/WebClipper/src/ui/popup/tabs/ChatsTab.tsx Extensions/WebClipper/src/ui/conversations/detail-header-actions.ts Extensions/WebClipper/src/ui/conversations/DetailHeaderActionBar.tsx`

Run: `git commit -m "feat: task3 - 接入notion与obsidian双目标显示规则"`

---

## P2-T4 补齐 phase2 回归测试与文档同步

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/popup-shell-header-actions.test.ts`
- Modify: `Extensions/WebClipper/tests/smoke/app-detail-header-actions.test.ts`
- Modify: `Extensions/WebClipper/tests/smoke/detail-header-actions.test.ts`
- Add: `Extensions/WebClipper/tests/smoke/detail-header-action-menu.test.ts`
- Modify: `Extensions/WebClipper/AGENTS.md`
- Modify: `.github/deepwiki/modules/webclipper.md`

**Step 1: 补齐菜单与 resolver 回归**

至少覆盖这些场景：
- 仅 Notion -> 直接按钮
- 仅 Obsidian -> 直接按钮
- Notion + Obsidian -> 下拉菜单
- 任一目标不可用时不会出现空菜单或错位占位

如果 Obsidian adapter 需要额外 capability 输入，优先在纯函数层 mock，不把复杂环境依赖塞进 UI 测试。

**Step 2: 同步文档**

在扩展入口文档中更新 detail header 行为说明：
- 右上角入口已变成 destination action 区
- Notion / Obsidian 共用同一协议
- 双目标时使用下拉菜单
- AI handoff 仍是后续 feature，不在本计划内

**Step 3: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-shell-header-actions.test.ts tests/smoke/app-detail-header-actions.test.ts tests/smoke/detail-header-actions.test.ts tests/smoke/detail-header-action-menu.test.ts`

Run: `npm --prefix Extensions/WebClipper run build`

Expected: compile、目标 smoke tests、Chrome build 全部通过。

**Step 4: 原子提交**

Run: `git add Extensions/WebClipper/tests/smoke/popup-shell-header-actions.test.ts Extensions/WebClipper/tests/smoke/app-detail-header-actions.test.ts Extensions/WebClipper/tests/smoke/detail-header-actions.test.ts Extensions/WebClipper/tests/smoke/detail-header-action-menu.test.ts Extensions/WebClipper/AGENTS.md .github/deepwiki/modules/webclipper.md`

Run: `git commit -m "test: task4 - 补齐多目标打开入口回归与文档"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录 Obsidian capability、菜单状态机、popup/app 一致性方面的发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
