# WebClipper Popup 会话列表“广播+订阅”实施计划

> 执行方式：建议使用 `executing-plans` 按 Task 逐步实现与验收。

**Goal（目标）:** Popup 打开期间，当 content script / background 写入（新增/更新/删除）会话时，popup 列表能通过“事件订阅”实时更新；移除 `2s` 轮询刷新。

**Non-goals（非目标）:**
- 不做采集逻辑/DB schema 改动
- 不引入新权限
- 不改国际化字段（如有）
- 不做大规模 UI 重构

**Approach（方案）:**
- Background 维护一个“会话事件 Hub”（保存所有 popup Port 订阅者），实现类似 Swift `NotificationCenter` 的广播/订阅
- 事件通道使用 `chrome.runtime.connect`（Port），与现有 `sendMessage` 的 request/response 消息类型**分离**
- 在后台发生会话变更（新增/更新/删除）后，Hub 广播 `conversationsChanged`（事件仅做“变更通知”，popup 仍执行全量 `getConversations` 作为最小闭环）
- Popup 打开时建立 Port 订阅；收到事件后做一次 `list.refresh()`（带节流/去重，避免连写造成抖动）
- 删除/禁用 `startLiveListRefresh()` 的 `setInterval` 轮询；可保留“订阅不可用时的降级轮询”但默认关闭

**Acceptance（验收）:**
- 打开 popup 后，在页面点击保存（inpage button）新增/更新会话：popup 列表在 0.5s 内更新（无需等待 2s）
- 在 popup 执行 Delete：列表立即更新且不会闪动
- Popup 关闭后：后台不应持续保活（Port 自动断开）
- `npm --prefix Extensions/WebClipper test` 通过

---

## P1（最高优先级）：建立跨上下文的订阅通道

### Task 1: 定义事件协议常量

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/message-contracts.js`

**Step 1: 实现**
- 新增 `UI_EVENT_TYPES`（推荐命名，避免与现有 `*_MESSAGE_TYPES` 混淆）：
  - `CONVERSATIONS_CHANGED: "conversationsChanged"`
- 新增 `UI_PORT_NAMES`：
  - `POPUP_EVENTS: "popup:events"`
- 约定 payload：`{ reason: "upsert"|"delete"|"import"|"articleFetch", conversationId?: number, conversationIds?: number[] }`（先最小集即可）

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

### Task 2: Background 端实现“事件 Hub”（广播中心）

**Files:**
- Create: `Extensions/WebClipper/src/bootstrap/background-events-hub.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`（`importScripts` 引入）
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`（注册 `onConnect` + 广播）

**Step 1: 实现**
- `background-events-hub.js` 提供：
  - `registerPort(port)`：加入 `Set`；监听 `port.onDisconnect` 移除
  - `broadcast(type, payload)`：遍历 ports `postMessage({ type, payload })`，失败时移除
- `background-router.js` 增加 `chrome.runtime.onConnect.addListener`：
  - 只接受特定 `port.name`（例如 `UI_PORT_NAMES.POPUP_EVENTS`），避免其它连接误入
  - `registerPort(port)`
 - 说明（写在代码附近的注释即可）：popup 打开期间 Port 会使 MV3 Service Worker 保持活跃；popup 关闭后自动断开，SW 才会被回收（这符合“关闭后不持续保活”的验收口径）

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

### Task 3: 在会话变更点触发广播（替代轮询的关键）

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- 可能 Modify: `Extensions/WebClipper/src/collectors/web/article-fetch-service.js`（若其写入绕过 router 的变更点）

**Step 1: 实现**
- 广播时机（推荐规则，避免“会话已出现但消息未同步完”的窗口期）：
  - 在 `SYNC_CONVERSATION_MESSAGES` 成功后广播：`hub.broadcast(CONVERSATIONS_CHANGED, { reason:"upsert", conversationId })`
  - `UPSERT_CONVERSATION` 仅返回会话 id，不触发广播（或仅作为可选兜底，最终以节流合并为准）
- 在 `DELETE_CONVERSATIONS` 成功后：广播 `{ reason:"delete", conversationIds: ids }`
- 对 “Fetch Active Tab Article” 若会写入 `conversations`：
  - 若 router 能拿到写入结果（包含 `conversationId`），就在 router 广播
  - 否则在 `article-fetch-service.js` 写入成功后广播一次（`reason: "articleFetch"`）

**Step 2: 验证**
- 手工：打开 popup，触发保存/删除，观察列表是否即时更新
- Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

### Task 3.5: 盘点“绕过 background-router 的本地写入”并确保 UI 刷新

**Why:** 当前 popup 的“数据库导入/合并”会在 popup 侧直接操作 IndexedDB（不经过 `background-router`），因此不会收到 background 广播，需要在 popup 流程结束时显式刷新列表。

**Files:**
- Verify/Modify: `Extensions/WebClipper/src/ui/popup/popup-database.js`

**Step 1: 实现/确认**
- 确认导入/合并成功后会触发一次 `list.refresh()`（并能正确更新筛选下拉 options）
- 如当前没有刷新：在导入成功回调里补一次 `list.refresh()`（只对 popup 自身生效，不需要 background 广播）

**Step 2: 验证**
- 手工：在 popup 导入备份后，Chats 列表即时出现新增会话（无需重开 popup）

---

## P2：Popup 订阅与 UI 更新（移除 2 秒轮询）

### Task 4: Popup 建立订阅并在事件到达时刷新

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js` 或 Create: `Extensions/WebClipper/src/ui/popup/popup-events.js`
- （可选）Modify: `Extensions/WebClipper/src/shared/runtime-client.js`（提供 connect helper，但也可直接用 `chrome.runtime.connect`）

**Step 1: 实现**
- Popup init 时：`const port = chrome.runtime.connect({ name: UI_PORT_NAMES.POPUP_EVENTS })`
- 监听 `port.onMessage`：
  - 收到 `conversationsChanged` 时触发 `list.refresh()`
  - 加节流/去重：例如 100–250ms 内合并多次事件，避免连写时抖动
- 监听 `port.onDisconnect`：停止刷新/清理定时器

**Step 2: 验证**
- 手工：连续触发保存多次，popup 列表更新不闪动、不频繁重排
- Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

### Task 5: 移除 `startLiveListRefresh()` 轮询

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`

**Step 1: 实现**
- 删除或默认不调用 `startLiveListRefresh()`（当前在 `popup.js` 里调用）
- 可选降级（建议写清触发条件，避免常态回退到轮询）：
  - `chrome.runtime.connect` 抛错 / 立即断开且 `lastError` 显示不可用 → 才启用轮询
  - 否则默认仅依赖广播订阅

**Step 2: 验证**
- 手工：打开 popup 不应每 2 秒触发刷新
- Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

---

## P3：测试补强（防回归）

### Task 6: 单测 background-router 的“广播触发”

**Files:**
- Create: `Extensions/WebClipper/tests/smoke/background-router-conversations-events.test.ts`

**Step 1: 实现**
- 在 test 中注入 `globalThis.WebClipper.backgroundEventsHub = { broadcast: vi.fn() }`（或按最终实现注入点）
- router 侧对 hub 缺失必须容错（判空/可选链），避免 load-order 或最小 mock 场景报错
- 调用 `router.__handleMessageForTests({ type:"upsertConversation", payload:{...} })`，断言 `broadcast` 被调用
- delete 分支同理

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper test`  
Expected: PASS

---

## 不确定项（需要确认一次）
- 刷新粒度：先采用“事件触发 + popup 全量 `getConversations`”作为最小闭环；后续如需优化再考虑事件携带 conversation 摘要做增量更新。
