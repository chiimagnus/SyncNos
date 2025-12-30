# SyncNos DetailView 内存释放 Plan A（破坏性重构允许）

更新时间：2025-12-30

## 目标与边界

- **目标**：显著降低 DetailView（右侧详情）在“切换条目/退出详情/切换数据源”时的**内存峰值**与**残留占用**，确保对象能按预期释放（deinit），并避免后台任务继续持有大对象导致无法回收。
- **范围（DetailView 优先）**：
  - Apple Books：`AppleBooksDetailView` / `AppleBooksDetailViewModel`
  - GoodLinks：`GoodLinksDetailView` / `GoodLinksDetailViewModel`
  - WeRead：`WeReadDetailView` / `WeReadDetailViewModel`
  - Dedao：`DedaoDetailView` / `DedaoDetailViewModel`
  - Chats：`ChatDetailView` / `ChatViewModel`
- **不在范围**：切换数据源时 ListView（左侧）性能优化（允许同时加载多个 listview）。
- **硬约束**：**不能影响同步到 Notion**（`NotionSyncEngine`/Adapters/NotionService 的行为保持不变；仅允许在 Detail 的生命周期管理与数据加载层面动刀）。

## 已逐一审阅的关键文件（本轮扫描结论依据）

- AppleBooks
  - `SyncNos/Views/AppleBooks/AppleBooksDetailView.swift`
  - `SyncNos/ViewModels/AppleBooks/AppleBooksDetailViewModel.swift`
- GoodLinks
  - `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`
  - `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`
- WeRead
  - `SyncNos/Views/WeRead/WeReadDetailView.swift`
  - `SyncNos/ViewModels/WeRead/WeReadDetailViewModel.swift`
- Dedao
  - `SyncNos/Views/Dedao/DedaoDetailView.swift`
  - `SyncNos/ViewModels/Dedao/DedaoDetailViewModel.swift`
- Chats
  - `SyncNos/Views/Chats/ChatDetailView.swift`
  - `SyncNos/ViewModels/Chats/ChatViewModel.swift`
- Main 组装与生命周期（决定 Detail 是否真的销毁）
  - `SyncNos/Views/Components/Main/MainListView.swift`
  - `SyncNos/Views/Components/Main/MainListView+DetailViews.swift`
- 通用卡片/布局（影响 Detail 渲染成本与峰值）
  - `SyncNos/Views/Components/Cards/WaterfallLayout.swift`
  - `SyncNos/Views/Components/Cards/HighlightCardView.swift`
  - `SyncNos/Views/Components/Cards/ArticleContentCardView.swift`

## 关键问题归因（按“会导致内存无法释放/峰值不受控”的严重性排序）

### A. 未绑定 SwiftUI 生命周期的 `Task { ... }`（P1）

多个 DetailView 在 `.onAppear` / `.onChange` 中直接创建 `Task { ... }`：

- 这类 Task **不会因为 View 消失而自动取消**（区别于 `.task(id:)` 修饰符）。
- Task 会强引用其捕获对象（尤其是 `@StateObject` 的 detailViewModel），从而导致：
  - Detail 退场后仍被 Task 持有 → **deinit 不触发** → 内存残留
  - 快速切换条目时旧 Task 继续跑 → **叠加后台工作** → 峰值上升、结果回写错位

### B. “取消加载任务”实现无效（AppleBooks 特别严重，P1）

`AppleBooksDetailViewModel` 目前用 `currentLoadTask: Task<Void, Never>?` 试图取消加载，但实际 DB fetch 使用的是另一个 `Task<[HighlightRow]?, Never>`，取消 `currentLoadTask` 并不会取消真正的 fetch task → **切书/退出 Detail 后仍可能继续读取数据库并持有 session/数据**。

### C. DetailViewModel 同时持有多份大数组（WeRead/Dedao/Chats，P2）

- WeRead：`allBookmarks`（原始） + `filteredHighlights`（转换后） + `visibleHighlights`（分页可见）
- Dedao：`allNotes`（原始） + `filteredHighlights`（转换后） + `visibleHighlights`
- Chats：分页 `loadedMessages` 之外，还维护 `conversations[UUID].messages`，并在导入/更新时对两份数组分别 append，存在“写时复制 + 双份增长”的风险。

这些结构在数据量大时会放大峰值；即使 Swift Array 有 COW，也会在多处 mutation 时触发复制。

### D. GoodLinks 全文内容（`contentText`）可能非常大（P2）

`GoodLinksDetailViewModel.loadContent()` 会在进入详情时直接加载全文，`content` 在内存中保持大字符串；即使 UI 处于折叠态也不释放 → **峰值容易被“全文”撑爆**。

### E. 重复/分散的“宽度 debounce Task”与同步通知处理（P2）

各 DetailView 都有类似的 `layoutWidthDebounceTask`，通常没有在 `onDisappear` 中统一 cancel；同步通知/错误弹窗处理也有大量重复代码，适合抽象/删除冗余。

---

## Plan A（按 P1 → P2 → P3 执行；每完成一个 P 都 `xcodebuild`）

## P1（最高优先级）：让 Detail “能退出、能取消、能释放”

**目标**：任何 Detail 在以下事件发生时，都必须满足：

- 旧加载任务被取消（或其结果被丢弃）
- 大对象/大数组被清理（不保留 capacity）
- 数据源会话（如 AppleBooks DB session）被关闭
- DetailViewModel 不被悬挂任务持有，能触发 deinit

### P1.1 统一把 Detail 的加载改成“生命周期绑定任务”

对以下文件进行改造：  
`AppleBooksDetailView.swift` / `GoodLinksDetailView.swift` / `WeReadDetailView.swift` / `DedaoDetailView.swift`

- 把 `.onAppear { Task { ... } }`、`.onChange { Task { ... } }` 改为：
  - `.task(id: selectedId) { ... }`（当 selectedId 变化或 View 消失时自动 cancel）
  - 或者显式存储 `Task` handle，并在 `onDisappear` + `onChange` 时 cancel（更不推荐）

> Chats 目前已经对首次加载用了 `.task(id:)`，P1 仅需要补齐“切换对话时卸载旧消息/取消旧加载”。

### P1.2 AppleBooks：修复“取消无效” + 强制释放数组容量

文件：`AppleBooksDetailViewModel.swift`

- 把 `currentLoadTask` 改成真正的 fetch task（或把 fetch task 放到一个可取消的 `Task<Void, Never>` 内部并持有它）
- 在切书/退出时：
  - `currentLoadTask?.cancel()`
  - `session?.close(); session = nil`
  - `highlights.removeAll(keepingCapacity: false)`

### P1.3 GoodLinks：为 highlights/content 加入可取消与过期结果丢弃

文件：`GoodLinksDetailViewModel.swift`

实现要点：

- 增加 `currentLoadTask: Task<Void, Never>?`（或拆成 `highlightsTask`/`contentTask`）
- 每次开始加载前先 cancel 旧 task
- 每次 await 返回后校验 `currentLinkId` 是否仍是本次请求的 linkId，若不一致则直接丢弃结果
- `clear()` 内部改为 `removeAll(keepingCapacity: false)`，并将 `content = nil`

### P1.4 WeRead/Dedao：后台同步任务可取消 + 过期结果丢弃 + 清空容量

文件：`WeReadDetailViewModel.swift`、`DedaoDetailViewModel.swift`

- 增加 `currentLoadTask` / `currentSyncTask`（或统一 `currentTask`）
- `loadHighlights(for:)` 若切书：
  - cancel 前一个任务
  - 清空 `allBookmarks/allNotes`、`filteredHighlights`、`visibleHighlights`（`keepingCapacity: false`）
- `performBackgroundSync` / `fullFetchFromAPI` 完成后必须校验当前 bookId 仍匹配，否则不回写

### P1.5 Chats：Detail 退场/切换对话时卸载消息（只保留当前对话）

文件：`ChatViewModel.swift` + `ChatDetailView.swift` + `MainListView+DetailViews.swift`

新增能力：

- `unloadMessages(for contactId: UUID)`：清空该对话的 `paginationStates[contactId].loadedMessages` 并重置 `hasInitiallyLoaded`（让下次选中能重新分页加载），同时**不要**破坏 messageCount（totalCount 从缓存再取即可）。
- `unloadAllMessages(except keepId: UUID?)`：只保留当前对话消息，其余全清空。

触发点：

- `ChatDetailView`：`onChange(of: selectedContactId)` 里对旧 contact 调用卸载（或在 `.task(id:)` 切换前后做）
- `MainListView`：切换数据源/选择清空时，对 chats 调用 `unloadAllMessages(except: nil)`（释放 Detail 内存）

> 由于你明确“不需要优化切换性能”，所以这里选择“激进释放”：只要离开当前对话就丢弃已加载消息，最大化回收。

### P1.6 取消 `layoutWidthDebounceTask`（防止后台悬挂）

文件：所有 DetailView（AppleBooks/GoodLinks/WeRead/Dedao）

- `.onDisappear { layoutWidthDebounceTask?.cancel(); layoutWidthDebounceTask = nil }`
- 或者把宽度 debounce 抽到一个复用组件/Modifier（P2 做去冗余）

### P1 验证（必须执行）

1. `xcodebuild -scheme SyncNos -configuration Debug build`
2. 手工验证（建议步骤）：
   - 快速在同一数据源内切换不同条目（书/文章/对话），观察是否出现旧内容回写/闪回
   - 切换数据源 → 再切回 → 确认 Detail 重新加载且不会崩溃
   - 退出某 Detail（让右侧变为 placeholder）→ 再进入 → 确认加载正常

---

## P2（第二优先级）：降峰值 + 去冗余（更激进但收益大）

### P2.1 GoodLinks：全文内容延迟加载 + 折叠即释放

文件：`GoodLinksDetailView.swift`、`GoodLinksDetailViewModel.swift`、`ArticleContentCardView.swift`

策略：

- 仅在用户点击“Expand/Load Article”时才加载全文
- 折叠时把 `content` 置空（释放大字符串）
- （可选）只保留一个短摘要/前 N 字用于折叠态展示

### P2.2 WeRead/Dedao：删除“原始大数组”或删除“展示大数组”（二选一）

文件：`WeReadDetailViewModel.swift`、`DedaoDetailViewModel.swift`

建议做法（更激进、更省内存）：

- 仅保留一种主数据：
  - 方案 A：只保留 `[Display]`（已经是 UI 需要的数据），不再保留 `[WeReadBookmark]/[DedaoEbookNote]`
  - 方案 B：只保留原始数组，`visibleHighlights` 用“slice + 即时转换”生成（避免全量转换）

### P2.3 Chats：移除 `conversations[UUID].messages`（只保留 metadata）

文件：`ChatViewModel.swift`（可能涉及 `Models/Chats/*`）

- `conversations` 只保存 `ChatConversation(contact: ...)` 的 metadata，不再持有 messages
- 导出：
  - 优先用当前分页 `loadedMessages`
  - “导出全部”仍从 cache 拉全量（允许一次性高峰，但这是用户主动动作）
- 导入/分类更新：只更新分页态数据 + 落库，不再维护第二份 messages

### P2.4 抽象复用：统一的 Detail 生命周期管理与清理协议

目的：删除重复的 “Task 管理/清理数组/宽度 debounce/同步进度通知” 代码。

可以引入：

- `protocol DetailMemoryReleasable { func cleanupForReuse(); func cleanupForDisappear() }`
- `DetailTaskBag`（集中持有/取消 Task）
- （可选）统一的 `DebouncedWidthTracker` ViewModifier

> 这一步是去冗余的关键：你偏“激进”，P2 会把现在分散在各 Detail 的重复实现合并并删掉。

### P2 验证

1. `xcodebuild -scheme SyncNos -configuration Debug build`
2. 手工：GoodLinks 打开大文章 → 展开/折叠 → 切换文章 → 确保内容不会串、不会长期常驻。

---

## P3（第三优先级）：渲染/布局优化（可选，但对极大数据有帮助）

### P3.1 `WaterfallLayout` 加缓存（Layout cache）避免频繁全量 sizeThatFits

文件：`WaterfallLayout.swift`

- 使用 Layout 的 `Cache` 存储上次计算结果（positions/columnWidth/height）
- 仅当宽度/子视图数量变化时重算

### P3.2 进一步虚拟化

如果未来出现“单条目高亮上千条”的极端场景：

- 考虑用 `LazyVGrid` + 分页（替代 waterfall），或改用 `List`（macOS 更成熟的复用机制）

### P3 验证

同样 `xcodebuild`，并观察滚动/窗口 resize 是否更稳。

---

## 执行顺序建议（强约束：每完成一个 P 就 build）

1. 先做 P1（生命周期绑定 + 真取消 + 真清理）→ **立刻 build**
2. 再做 P2（删除冗余 + 降峰值）→ **再 build**
3. 最后视情况做 P3（布局/虚拟化）→ **再 build**


