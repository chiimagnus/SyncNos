# SyncNos 内存释放「根本性修复」方案（Root Fix Plan）

> 目的：在 **不牺牲数据正确性** 的前提下，彻底解决「快速切换条目/数据源」导致的内存累积、后台任务串线、重复计算与 UI 卡顿等问题。
>
> 本文基于对现有 `MEMORY_OPTIMIZATION_PLAN.md` 与实际代码实现的逐条核验，提炼出 **可落地** 的修复范式与分模块执行清单。

---

## 1. 背景与目标

### 1.1 背景

SyncNos 的各数据源 Detail 页面（Apple Books / GoodLinks / WeRead / Dedao / Chats）普遍采用：

- View 内 `@StateObject` 持有 DetailViewModel（View 生命周期内长期存在）
- 通过 `selectedBookId/selectedLinkId/...` 切换展示对象
- ViewModel 内部既有分页数据，也可能启动后台同步（网络/数据库）

在「频繁切换」场景下，如果 **旧任务未能真正取消**、或 **旧任务完成后仍可写回状态**，就会出现：

- 内存无法及时释放 / 数据短暂串线（旧 book 的结果写回新 book 的 UI）
- 重复触发筛选/排序/分页重算（额外内存与 CPU）
- 数据库/IO 在 MainActor 上执行导致卡顿

### 1.2 目标（可验证的行为约束）

本文定义 4 条 **硬约束**，后续所有改动都以此为验收标准：

1. **切换对象时：旧任务必须可取消且会被取消**（并且取消能影响到真正执行查询/网络的任务）
2. **旧任务即使完成，也绝不允许写回当前 UI 状态**（必须有“防串线”机制）
3. **与筛选/排序相关的重算，必须收敛到 ViewModel 的单一入口**（避免 View / Notification / Combine 多处重复触发）
4. **数据库/重计算/IO 不能阻塞 MainActor**（至少保证分页查询与网络拉取在非 MainActor 执行，写回 UI 在 MainActor）

---

## 2. 现状核验（对照代码的结论）

> 仅列出对“内存释放与串线”最关键的结论；细节以文件内注释与后续改动为准。

### 2.1 已确认「确实存在」的实现

- **AppleBooks**：`AppleBooksDetailViewModel.clear()` 已存在，且会关闭 session、清空数组与状态。
  - 文件：`SyncNos/ViewModels/AppleBooks/AppleBooksDetailViewModel.swift`
- **WeRead**：`WeReadDetailViewModel.currentLoadTask` + `clear()` 已存在，且在 `performLoadHighlights/performBackgroundSync/fullFetchFromAPI` 内有 `Task.isCancelled` 检查。
  - 文件：`SyncNos/ViewModels/WeRead/WeReadDetailViewModel.swift`
- **Dedao**：`DedaoDetailViewModel.currentLoadTask` + `clear()` 已存在，且 `performLoadHighlights/performBackgroundSync` 多处检查 `Task.isCancelled`。
  - 文件：`SyncNos/ViewModels/Dedao/DedaoDetailViewModel.swift`
- **Chats**：LRU 淘汰策略已实现，并且 Detail 页面会触发加载，从而触发淘汰。
  - LRU：`SyncNos/ViewModels/Chats/ChatViewModel.swift`（`maxCachedConversations`/`conversationAccessTime`/`evictOldConversationsIfNeeded`）
  - 触发：`SyncNos/Views/Chats/ChatDetailView.swift`（`.task(id: contact.contactId)` 调用 `loadInitialMessages`）

### 2.2 已确认的「高风险缺陷」（需要根本修复）

#### A) AppleBooks：取消链路断裂 + 查询可能阻塞 MainActor

现状（代码层面的事实）：

- `loadNextPage` 内部创建了 `loadTask = Task<[HighlightRow]?, Never> { ... }` 执行 `session.fetchHighlightPage(...)`
- `currentLoadTask` 被赋值为 **另一个 wrapper Task**：`currentLoadTask = Task { _ = await loadTask.value }`

风险：

- `currentLoadTask?.cancel()` **取消不到真正执行查询的 `loadTask`** → 旧查询可能继续跑完
- 由于 ViewModel 标注 `@MainActor`，`Task { ... }` 默认继承 actor，存在 **查询/重计算仍在 MainActor 上执行** 的风险（即使 session 内有串行队列，外层仍会同步等待结果 → UI 卡顿）

需要的修复方向：

- 让 `currentLoadTask` 持有 **真正执行查询** 的 Task（而不是 wrapper）
- 把查询放到非 MainActor（`Task.detached` 或显式后台队列）执行，并在 MainActor 写回 UI
- 加入“assetId 仍匹配”的防串线保护（已有部分 guard，但要覆盖所有写回点）

#### B) Dedao：缓存命中后的后台同步 Task 未追踪 → 可串线/不可取消

现状：

- 缓存命中时，会启动 `Task { await performBackgroundSync(bookId:) }`（未保存句柄）
- `clear()` 只会 cancel `currentLoadTask`，**不会 cancel 这个后台同步 Task**

风险：

- 切换书籍后，旧后台同步仍可能返回并写回 `allNotes/visibleHighlights/isLoading` 等 → **新书页面被旧书数据覆盖（串线）**
- 旧任务继续持有大数组、网络结果、解析对象 → **额外内存占用**

需要的修复方向：

- 将后台同步纳入可取消任务（例如 `currentSyncTask`），并在 `clear()`/切换时取消
- 任何写回点都必须先验证 `currentBookId == bookId`（或更严格的 token）

#### C) GoodLinks：DetailView 内重复 onChange + 多处重复 reapplyFilters

现状：

- `GoodLinksDetailView` 对 `linkId` 有两处 `.onChange`（一次滚动到顶，一次 clear+reload）
- 还存在多处 `.onChange`/`.onReceive` 重复调用 `detailViewModel.reapplyFilters()`

风险：

- 切换 link 时同一副作用被多次触发 → 重复清理/重复加载/重复重算
- 当数据量较大时会引入额外 CPU 与内存峰值

需要的修复方向：

- 合并成单一入口：切换 link 的副作用在一个 onChange 内完成
- 将筛选/排序的联动收敛到 ViewModel Combine 管道，View 不再多点触发

---

## 3. 根因总结（为什么“看起来做了 clear/cancel”但仍会有问题）

1. **取消句柄不等于取消实际工作**  
   只有当句柄指向真正执行 IO/计算的 Task（或其可取消子任务）时，`cancel()` 才有意义。

2. **后台任务不追踪，就无法在切换时终止**  
   “缓存命中后后台同步”这种模式如果不保存 task handle，几乎必然会留下串线/内存持有风险。

3. **仅靠 `Task.isCancelled` 不足以防串线**  
   取消是协作式的；网络/数据库可能不会立刻停止。必须同时具备 **防串线 token** 或 **currentId 校验**。

4. **重复 onChange / 多点触发重算，会把优化变成负担**  
   View/Notification/Combine 三处都触发同一副作用时，极易出现重复清理/重复加载/重复排序。

---

## 4. 统一修复范式（所有 DetailViewModel 推荐采用）

> 目标：把“切换对象 → 取消旧任务 → 清空旧数据 → 加载新数据 → 后台刷新”变成可复用的固定模式。

### 4.1 任务模型：LoadTask + SyncTask（两条线）

推荐每个 DetailViewModel 至少具备：

- `currentLoadTask: Task<Void, Never>?`：负责“缓存加载 + 首屏展示”
- `currentSyncTask: Task<Void, Never>?`：负责“后台增量同步/全量刷新”

并且：**两者都必须在 `clear()` 中取消**。

### 4.2 防串线：generation token（推荐）或 currentId 校验（最低要求）

最低要求（简单版）：

- 每次写回 UI 前都 `guard currentId == id else { return }`

推荐（更稳）：

- 使用递增 `generation: UInt64`（或 UUID token）
- 每次切换时 `generation &+= 1`，并在 Task 内捕获 `let token = generation`
- 写回前 `guard token == generation else { return }`

这能覆盖“任务未及时响应取消但仍返回”的情况。

### 4.3 单一入口：`switchTo(id:)`

建议将切换逻辑收敛成一个方法：

- `func switchTo(bookId: String) async`
  - 内部先 `clear()`（取消+清空+重置状态）
  - 再启动新的 load/sync 任务

View 层只负责在 `onChange`/`task(id:)` 调用这一个入口。

---

## 5. 分模块落地清单（按优先级）

### P0（必须修）：AppleBooks / Dedao

#### P0.1 AppleBooks

- 修复 `currentLoadTask` 指向错误：取消要命中“真正执行查询”的 task
- 将 DB 查询移出 MainActor（例如 `Task.detached`），仅在 MainActor 更新 `highlights/isLoadingPage/errorMessage`
- 统一 `clear()` 与 `resetAndLoadFirstPage()` 的职责，避免重复清理与 10ms sleep 这种不确定机制
- 在所有写回点增加 token 校验，避免 asset 切换后的串线

涉及文件：

- `SyncNos/ViewModels/AppleBooks/AppleBooksDetailViewModel.swift`
- （可选）`SyncNos/Views/AppleBooks/AppleBooksDetailView.swift`：合并重复 `onChange(of: selectedBookId)` 逻辑（scroll + clear + external sync reset）

#### P0.2 Dedao

- 引入 `currentSyncTask`（或把后台同步合并回 `currentLoadTask` 的结构化任务中）
- `clear()`/切换时取消后台同步 task
- 所有写回点都需 `guard currentBookId == bookId` 或 token 校验

涉及文件：

- `SyncNos/ViewModels/Dedao/DedaoDetailViewModel.swift`
- `SyncNos/Views/Dedao/DedaoDetailView.swift`（保持只调用单一入口）

### P1（强烈建议）：GoodLinks / AppleBooks View 去冗余 + ViewModel 管道化

#### P1.1 GoodLinks

- 合并重复 `.onChange(of: linkId)`（滚动到顶 + clear/reload 合并为一次）
- 将筛选/排序联动下沉到 `GoodLinksDetailViewModel`（CombineLatest + debounce + removeDuplicates）
- 删除 View 内多处 `.onChange` 触发的 `reapplyFilters()`（避免重复重算）
- （可选但推荐）为 `loadHighlights/loadContent` 引入可取消句柄（防止快速切换时旧任务写回）

涉及文件：

- `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`
- `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

#### P1.2 AppleBooks View 去冗余

- 合并重复 `.onChange(of: selectedBookId)`（目前至少 2 处：滚动到顶 + clear/load + external sync reset）
- 让“切换副作用”只有一个入口，避免重复 reset/external 状态抖动

### P2（可选增强）：WeRead / Chats

#### P2.1 WeRead

现状整体较好；可做的增强：

- 关键写回点增加 `currentBookId == bookId` 校验（与 token 二选一）
- deinit 中显式 cancel（可读性增强；虽非必需）

#### P2.2 Chats

LRU 已实现且工作路径正确；可选增强：

- 当对话被淘汰时可同步清理 `conversationAccessTime` 中对应 key（降低字典增长风险）
- 访问时间可在“仅切换选中但未触发加载”的场景也更新（如果未来 UI 变更导致不一定触发 load）

---

## 6. 验证方案（必须覆盖的压测场景）

### 6.1 场景

- **快速切换**：连续快速切换 20 本书/文章/对话，观察峰值内存与回落曲线
- **切换 + 分页**：在 Detail 中加载多页后切换，再切回，确认旧页数据不会常驻
- **切换 + 后台同步**：在 Dedao/WeRead 后台同步进行时切换条目，确保不会串线写回
- **多数据源切换**：AppleBooks ↔ GoodLinks ↔ WeRead ↔ Dedao ↔ Chats 来回切换

### 6.2 指标

- Instruments Allocations：切换后内存应明显回落（特别是大数组与字符串）
- Time Profiler：DB 查询/网络解析不应出现在 Main Thread 长耗时段
- 日志（可选）：记录 token/currentId，确认旧任务不会写回

---

## 7. 实施步骤（建议执行顺序）

1. 先落地 **P0 AppleBooks/Dedao**（解决串线与不可取消，这是“根本性”关键）
2. 再落地 **P1 GoodLinks/AppleBooks 去冗余**（减少重复触发与重复计算）
3. 最后做 **P2 可选增强**（WeRead/Chats 小修小补）
4. 每个阶段结束跑一次 `xcodebuild`，并用 Instruments 做一次快速切换压测

---

## 8. 与旧文档的关系

- `MEMORY_OPTIMIZATION_PLAN.md`：保留作为历史记录与阶段性总结
- 本文（Root Fix Plan）：作为后续“根本性修复”的执行蓝图，重点强调 **取消链路正确性** 与 **防串线硬约束**


