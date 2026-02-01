# 同步到 Notion 启动顺序跟随 ListView（破坏性重构）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 当用户在各个数据源列表中触发“批量同步到 Notion”（或自动同步）时，同步任务的**启动顺序**应尽量与用户当前的 ListView 排序一致（从上到下），同时保持并发（并发=K 时优先启动前 K 个，完成一个补一个）。

**Non-goals（非目标）:**
- 不保证任务**完成顺序**（并发下允许交错完成）。
- 不做向后兼容（允许 breaking API / 重命名 / 删除旧逻辑）。
- 不修改国际化资源（例如 `Resource/Localizable.xcstrings`）。

**Approach（方案）:**
- 将“有序并发启动”的语义抽成一个统一的 runner（滑动窗口并发），避免每个 ViewModel/Provider 自己写一套并发调度。
- 将 `SyncQueueStore.enqueue(...)` 的返回值由 `Set<String>` 改为**有序**的 `[String]`（按入队顺序），让调用方可以在“已被接受的任务”集合上仍保留 ListView 顺序。
- 手动批量同步：从当前 ListView 的派生列表（`display*`）中生成 `orderedSelectedIds`，并用 runner 启动。
- 自动同步：始终以“全量列表”为准（不受筛选/搜索影响），但排序规则跟随用户的 `sortKey/sortAscending`（从 UserDefaults 读取），再用 runner 启动。

**Acceptance（验收）:**
- 手动批量同步（任一数据源）：当并发=2 且 ListView 顺序为 A→B→C 时，应先启动 A/B，再启动 C（以 `SyncQueueStore` 任务状态或日志观察）。
- 自动同步（任一数据源）：eligible 列表的启动顺序符合该数据源当前 `sortKey/sortAscending` 对应的“全量列表”排序。
- `SyncQueueStore` UI 展示顺序与入队顺序一致，且入队顺序与 ListView 顺序一致。

---

## Plan A（主方案）

### P1：打通“有序入队 + 有序启动”的基础设施

#### Task 1: 让 SyncQueueStore 的 enqueue 返回“有序 acceptedIds”

**Files:**
- Modify: `SyncNos/Services/Core/Protocols.swift`（`SyncQueueStoreProtocol`）
- Modify: `SyncNos/Services/SyncScheduling/SyncQueueStore.swift`

**Steps:**
1. 将协议签名从 `func enqueue(...) -> Set<String>` 改为 `func enqueue(...) -> [String]`（顺序=入队顺序）。
2. `SyncQueueStore.enqueue(...)` 内部将 `acceptedIds` 改为 `[String]`，并在入队时按 `items` 的遍历顺序 append。
3. 逐一修正所有编译错误的调用点（此任务只改签名适配，不改行为）。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 2: 新增“有序并发启动”Runner（滑动窗口）

**Files:**
- Create: `SyncNos/Services/SyncScheduling/OrderedTaskRunner.swift`（或同目录命名一致）

**Design（建议接口）:**
- `OrderedTaskRunner` 为轻量工具类型（不需要 DI / 不需要状态），提供一个静态方法即可：

```swift
enum OrderedTaskRunner {
    static func runOrdered(
        ids: [String],
        concurrency: Int,
        operation: @escaping @Sendable (String) async -> Void
    ) async {
        // 滑动窗口：先启动前 concurrency 个；任一完成就补一个
    }
}
```

**Steps:**
1. 实现 `runOrdered(ids:concurrency:operation:)`：
   - `concurrency <= 0` 直接返回或 `precondition(concurrency > 0)`（根据项目风格选其一，允许破坏性）。
   - 使用 `withTaskGroup` + `group.next()` 进行“补位式”调度。
2. 保证“启动顺序”由 `ids` 决定：只在补位时取下一个 index。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

### P2：手动批量同步按 ListView 顺序启动（各数据源 ViewModel）

> 目标：所有 `batchSync(...)` 都使用同一 runner；并确保 `orderedSelectedIds` 的来源是当前 ListView 的“显示顺序”（通常是 `display*`）。

#### Task 3: AppleBooksViewModel.batchSync 使用有序 acceptedIds + runner

**Files:**
- Modify: `SyncNos/ViewModels/AppleBooks/AppleBooksViewModel.swift`

**Steps:**
1. 将 `bookIds: Set<String>` 转为 `orderedSelectedIds: [String]`：
   - 遍历 `displayBooks`，过滤出 `bookIds.contains(book.bookId)`，得到顺序数组。
2. 入队时构造 `enqueueItems` 也按 `orderedSelectedIds` 的顺序。
3. `let acceptedOrderedIds = syncQueueStore.enqueue(...items...)`（已是 `[String]`）。
4. 使用 `OrderedTaskRunner.runOrdered(ids: acceptedOrderedIds, concurrency: NotionSyncConfig.batchConcurrency, operation: ...)` 启动任务：
   - operation 内部包含原先每个 id 的同步逻辑（创建 adapter → `syncEngine.syncSmart` → 通知）。
   - `limiter.withPermit` 仍保留（作为全局并发兜底），但 runner 的并发应与 limiter 的配置保持一致。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 4: GoodLinksViewModel.batchSync 使用有序 acceptedIds + runner

**Files:**
- Modify: `SyncNos/ViewModels/GoodLinks/GoodLinksViewModel.swift`

**Steps:**
1. 生成 `orderedSelectedIds`：遍历 `displayLinks`，过滤 `linkIds`。
2. 按 `orderedSelectedIds` 构造 `enqueueItems`。
3. 使用 runner 替换 “for acceptedIds { group.addTask }” 这种一次性创建所有 task 的方式。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 5: WeReadViewModel.batchSync 使用有序 acceptedIds + runner

**Files:**
- Modify: `SyncNos/ViewModels/WeRead/WeReadViewModel.swift`

**Steps:**
1. 生成 `orderedSelectedIds`：遍历 `displayBooks`，过滤 `bookIds`。
2. 入队与 runner 同步改造同上。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 6: DedaoViewModel.batchSync 使用有序 acceptedIds + runner

**Files:**
- Modify: `SyncNos/ViewModels/Dedao/DedaoViewModel.swift`

**Steps:**
1. 生成 `orderedSelectedIds`：遍历 `displayBooks`，过滤 `bookIds`。
2. 入队与 runner 同步改造同上。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 7: ChatViewModel.batchSync 使用有序 acceptedIds + runner

**Files:**
- Modify: `SyncNos/ViewModels/Chats/ChatViewModel.swift`

**Notes:**
- Chats 列表顺序取决于 `contacts` 当前排序（目前看起来是按 name 排序）。

**Steps:**
1. 生成 `orderedSelectedIds`：遍历 `contacts`，过滤 `contactIds`。
2. 入队与 runner 同步改造同上。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

### P3：自动同步按用户排序偏好启动（各 AutoSyncProvider）

> 目标：自动同步不受筛选/搜索影响，但**排序规则**跟随用户偏好（`sortKey/sortAscending`），并且启动顺序按该排序。

#### Task 8: 提取“列表排序偏好”的共享存储（破坏性重构）

**Files:**
- Create: `SyncNos/Services/SyncScheduling/ListSortPreferences.swift`（或 `SyncNos/Models/Core/...`）
- Modify: `SyncNos/ViewModels/GoodLinks/GoodLinksViewModel.swift`（替换私有 Keys）
- Modify: `SyncNos/ViewModels/WeRead/WeReadViewModel.swift`（补齐持久化 Keys）
- Modify: `SyncNos/ViewModels/Dedao/DedaoViewModel.swift`（补齐持久化 Keys）
- (Optional) Modify: `SyncNos/ViewModels/AppleBooks/AppleBooksViewModel.swift`（若要统一 Keys 命名）

**Steps:**
1. 新建集中式 Keys 定义（示例）：
   - GoodLinks: `goodLinks.sortKey` / `goodLinks.sortAscending`
   - WeRead: `weRead.sortKey` / `weRead.sortAscending`
   - Dedao: `dedao.sortKey` / `dedao.sortAscending`
   - AppleBooks: 现有可先不动或一起统一（破坏性允许）。
2. ViewModel 写入 UserDefaults 改用集中式 Keys（确保 Provider 可读取）。
3. WeRead/Dedao：若目前未持久化（或 key 不一致），补上 debounce 写入逻辑。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 9: GoodLinksAutoSyncProvider 按 GoodLinks 列表排序启动

**Files:**
- Modify: `SyncNos/Services/SyncScheduling/GoodLinksAutoSyncProvider.swift`

**Steps:**
1. 从 DB 拉到 `allLinks` 后，基于 UserDefaults 的 sort 偏好构造 `orderedAllLinks`（全量，不受 starred/search 影响）。
   - 复用 `GoodLinksViewModel.buildDisplayLinks(...)` 的排序逻辑（可考虑抽出排序函数到共享位置，破坏性允许）。
2. eligible 过滤保持原逻辑，但最终 `eligibleOrderedIds` 的顺序应来自 `orderedAllLinks` 的遍历顺序。
3. 入队用有序 items，得到 `acceptedOrderedIds: [String]`。
4. 用 runner 启动（并发=NotionSyncConfig.batchConcurrency）。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 10: WeReadAutoSyncProvider 按 WeRead 列表排序启动

**Files:**
- Modify: `SyncNos/Services/SyncScheduling/WeReadAutoSyncProvider.swift`

**Steps:**
1. `books` 为全量（notebooks→books），按 sort 偏好（title/highlightCount/lastSync/lastEdited/created 等）排序成 `orderedBooks`。
2. eligible 过滤不改，最终 `acceptedOrderedBooks` 与 runner 启动按 `orderedBooks`。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 11: DedaoAutoSyncProvider 按 Dedao 列表排序启动

**Files:**
- Modify: `SyncNos/Services/SyncScheduling/DedaoAutoSyncProvider.swift`

**Steps:**
1. `books` 为全量（cache），按 sort 偏好排序成 `orderedBooks`。
2. eligible 过滤不改，启动顺序跟随 `orderedBooks`。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 12: AppleBooksAutoSyncProvider 按 AppleBooks 列表排序启动

**Files:**
- Modify: `SyncNos/Services/SyncScheduling/AppleBooksAutoSyncProvider.swift`

**Steps:**
1. AppleBooks 的“全量列表”来源是 `stats`/`bookMeta` 的组合；按偏好排序后得到 `eligibleOrderedIds`。
2. 入队与 runner 同步改造同上。

**Verify:**
- Build: `xcodebuild -scheme SyncNos build`

---

## 回归验证（每完成一个优先级后）

- P1 完成：`xcodebuild -scheme SyncNos build`
- P2 完成：`xcodebuild -scheme SyncNos build`，手动在 UI 里对任一数据源执行“Sync Selected to Notion”（并发>1）观察启动顺序
- P3 完成：`xcodebuild -scheme SyncNos build`，打开自动同步开关后观察 SyncQueue 的 queued/running 顺序是否符合排序偏好

---

## 不确定项（需要你确认）

1. Chats 的 ListView 顺序是否永远按 name？若未来支持按 lastMessageTime 排序，auto/manual 是否也要跟随？
2. “全量列表排序”对 AppleBooks 的定义：是按 `displayBooks` 的排序规则（title/highlightCount/lastSync/lastEdited/created），还是另有需求？

