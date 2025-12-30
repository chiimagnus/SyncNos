# SyncNos 内存释放 / 去冗余（破坏性）Plan A

> 目标：**可预测地释放内存**（切换数据源/关闭详情后应能明显回落）、避免后台任务“挂着不死”、删除重复/冗余实现，允许破坏性重构。

## 0. 我在代码里确认到的“根因级别”问题（基于现状代码）

### 0.1 主容器层：数据源 View / ViewModel 生命周期被“整体常驻”锁死

- `MainListView` 里把 **AppleBooks/GoodLinks/WeRead/Dedao/Chats 5 个 List ViewModel** 全部用 `@StateObject` 常驻持有（见 `SyncNos/Views/Components/Main/MainListView.swift`）。
- `SwipeableDataSourceContainer` 当前通过 `HStack + ForEach(enabledDataSources)` **一次性构建所有启用数据源的 ListView**（见 `SyncNos/Views/Components/Controls/SwipeableDataSourceContainer.swift`）。
  - 这通常意味着：
    - 多个 ListView 的 `.onAppear/.task` 可能在同一生命周期被触发（即使不在屏幕可视范围），导致多源数据 **并行加载/缓存**。
    - 切换数据源时：旧数据源的 VM 仍被 `MainListView` 强引用，数据数组/缓存不会释放。

### 0.2 多处存在“非结构化 Task”导致的不可控生命周期（阻止 deinit / 任务继续跑）

典型模式：View 中 `Task { await vm.load... }`（未保存引用），或 VM 内 `Task { ... }`（未做 cancel），会导致：
- View 消失后任务仍可能继续执行并持有 VM；
- 快速切换 selection/source 时出现多任务并发写入同一 VM 状态；
- 无法基于“切换数据源”统一停掉后台工作。

### 0.3 Chats 有明确的“消息数组双份存储”（冗余 + 额外内存占用）

`ChatViewModel` 同时维护：
- `conversations[UUID: ChatConversation]`（含 `messages: [ChatMessage]`）
- `paginationStates[UUID: ChatPaginationState]`（含 `loadedMessages: [ChatMessage]`）

并且在分页加载时会把 `loadedMessages` 同步回 `conversations[contactId].messages`，属于**同一份消息数据在内存里重复保留**（见 `SyncNos/ViewModels/Chats/ChatViewModel.swift`）。

### 0.4 WeRead/Dedao 详情 VM 同类“多数组缓存”普遍存在（可优化）

例如：
- WeRead：`allBookmarks`（原始）+ `filteredHighlights`（转换/筛选后）+ `visibleHighlights`（分页子集）
- Dedao：`allNotes`（原始）+ `filteredHighlights` + `visibleHighlights`

这不一定是 bug，但在大数据量时会放大峰值内存，且代码重复度高。

---

## 1. 验收与观测指标（每个优先级都要做）

### 1.1 释放指标（必须）
- **切换数据源**（例如 AppleBooks → GoodLinks → WeRead → Dedao → Chats），观察内存是否在短时间内明显回落，而不是一路只涨不降。
- **关闭/切换详情**（选择不同 item / 清空 selection），确认 Detail VM 能 `deinit`（或至少其大数组被清空）。

### 1.2 任务指标（必须）
- 切换数据源后，不应继续看到旧数据源的后台日志（例如 Dedao 批量抓取 notes count、WeRead 增量同步）持续输出。

### 1.3 Build 验证（必须）
每完成一个优先级（P1/P2/P3），都执行：

```bash
cd /Users/chii_magnus/Github_OpenSource/SyncNos
xcodebuild -scheme SyncNos -configuration Debug build
```

（如你本机 scheme 名称不同，以 Xcode 实际为准。）

---

## 2. P1（立刻做，收益最大，风险可控）——“让它能释放 + 让任务可停”

### P1-1：让主容器只构建“当前活动数据源”视图（禁止一次性建 5 个 List）
**目标**：避免多源同时 `onAppear` / 同时加载；同时让非当前源的 ListView 真正消失，从而触发 `.onDisappear`。

- **改动点**
  - `SyncNos/Views/Components/Controls/SwipeableDataSourceContainer.swift`
    - 把 `GeometryReader + HStack + ForEach(enabledDataSources)` 改为：只渲染 `viewModel.currentDataSource` 对应的单个 View。
    - 继续保留触控板 swipe handler、indicator bar、filter menu。

- **验收**
  - App 启动后只会加载当前 source 的列表数据（其它 source 不应“顺带”触发 load）。
  - 切换 source 时，旧 ListView 的 `.onDisappear` 能触发。

### P1-2：引入“数据源生命周期协议”，统一停后台任务 + 主动释放大数组
**目标**：切换数据源时，上一数据源立刻“收尸”：取消任务、清空大数组、释放临时缓存。

- **新增协议（建议放在 Services/Core 或 ViewModels/Core）**
  - `protocol DataSourceLifecycleControllable { func activate(); func deactivate(purgeMemory: Bool) }`

- **落地到这些 VM（至少）**
  - `AppleBooksViewModel`：停安全作用域访问（已有）、取消 list 相关后台计算/任务、可选清空 `books/displayBooks/visibleBooks`。
  - `GoodLinksViewModel`：取消加载任务、清空 `links/displayLinks/visibleLinks`（注意：不要在这里强行 stop security-scope，如果 GoodLinks 设计上要求常驻权限）。
  - `WeReadViewModel`：取消 `performBackgroundSync`、清空 `books/displayBooks/visibleBooks`、关闭登录 sheet 状态（如需要）。
  - `DedaoViewModel`：取消 `performBackgroundSync`（尤其是批量抓取 note counts 的循环）、清空 `books/...`。
  - `ChatViewModel`：取消导入/分页任务、按需清空 `paginationStates` 中不活跃会话的 `loadedMessages`。

- **主容器接入**
  - `MainListView` 在 source 切换时：
    - 对旧 source：`deactivate(purgeMemory: true)`
    - 对新 source：`activate()`

- **验收**
  - 切换 source 后，旧 source 的“长任务”日志停止。
  - 内存能回落。

### P1-3：把 View 中非结构化 Task 改为 `.task(id:)`，让系统自动取消
**目标**：View 消失/ID 变化时任务自动 cancel，避免 VM 被任务强引用导致无法释放。

- **优先改这些文件（高收益）**
  - `SyncNos/Views/Chats/ChatListView.swift`（当前 `.task { ... }`）
  - `SyncNos/Views/Chats/ChatDetailView.swift`（当前 `.task(id: contact.contactId)` 已有一处；其它 Task 也应结构化/可取消）
  - `SyncNos/Views/WeRead/WeReadListView.swift`
  - `SyncNos/Views/WeRead/WeReadDetailView.swift`（把 `Task { await detailViewModel.loadHighlights(...) }` 改 `.task(id: selectedBookId)`)
  - `SyncNos/Views/Dedao/DedaoListView.swift`
  - `SyncNos/Views/Dedao/DedaoDetailView.swift`
  - `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`（onAppear/onChange 触发的加载）

- **VM 内部配合**
  - 在 `load...` / `performBackgroundSync` 内部增加 `Task.isCancelled` 检查（关键循环/批次之间）。
  - 对“一个时刻只能跑一个加载”的场景，保存 `Task` 引用并在新请求时 cancel（例如 WeRead/Dedao detail）。

- **验收**
  - 快速切换 selection/source 时不出现“旧内容覆盖新内容”的竞态。
  - Detail VM 能按预期释放（观察 deinit 日志或行为）。

### P1-4：加 deinit/生命周期日志（只在 Debug），用来验证是否真的释放
**目标**：避免“我以为释放了”。

- 为关键 VM 增加：
  - `deinit { logger.debug("[Deinit] ...") }`
  - 或在 `deactivate()` 打印清空前后 count（books/highlights/messages）。

---

## 3. P2（中期，主要针对“冗余/重复实现”和“明显浪费”）——“减重复 + 减峰值”

### P2-1：Chats 消息内存结构重构（删除双份存储）
**目标**：让消息只存在一个权威来源，避免 `conversations.messages` 与 `paginationStates.loadedMessages` 双份。

推荐方案（破坏性）：
- `conversations` 只保留 `ChatContact` 元信息（或直接删掉 `conversations`，改为 `contacts` + `paginationStates`）。
- 导出/昵称统计：
  - 导出全部 → 永远从 `cacheService.fetchAllMessages(...)` 取（本来就这么做了）
  - 当前可见消息 → 直接用 `paginationStates[contactId].loadedMessages`
  - `getUsedSenderNames` → 从 `paginationStates` 取“已加载”或直接从 cache 查（可选）

涉及文件：
- `SyncNos/ViewModels/Chats/ChatViewModel.swift`

### P2-2：抽公共的分页/筛选骨架（删重复代码）
**目标**：WeReadDetail/DedaoDetail/GoodLinksDetail 的分页/加载更多/筛选排序逻辑高度同构，建议抽一层复用。

可选实现方式（组合优先）：
- `PagedResultsController<Item>`：负责 `pageSize/currentPage/isLoadingMore/canLoadMore/visibleItems`。
- `FilterSortPipeline<Raw, Display>`：负责 raw → display 的筛选/排序/映射（闭包注入）。

### P2-3：统一“外部同步状态显示”与 Notification 监听（删重复监听）
**目标**：多个 DetailView 都在做同一套：
- `externalIsSyncing/externalSyncProgress`
- 监听 `SyncProgressUpdated` / `SyncBookStatusChanged`

建议抽成：
- `@StateObject var externalSync = ExternalSyncState(sourceIdBinding: ...)`
- 或 ViewModifier：`.bindExternalSync(bookId: selectedId, source: .weRead, ...)`

并且清理“注释说已迁移，但代码仍残留”的监听（例如 `GoodLinksDetailView` 仍监听 `RefreshBooksRequested`）。

### P2-4：统一布局宽度 debounce（删重复 Task 状态）
**目标**：AppleBooks/GoodLinks/WeRead/Dedao Detail 都有：
- `measuredLayoutWidth/debouncedLayoutWidth/layoutWidthDebounceTask`

建议抽：
- `@StateObject var widthDebouncer = LayoutWidthDebouncer(delay: 0.3)`
- 或 `ViewModifier` 返回 debounced width。

---

## 4. P3（长期/可选，进一步极致优化）

### P3-1：数据源 VM 的 LRU/配额缓存（在“释放”和“切回速度”间取平衡）
- 允许同时保留最近 1~2 个数据源 VM 的数据；其它数据源自动 `purgeMemory`。

### P3-2：GoodLinks 正文内容按需加载（降低大字符串常驻）
- 仅在“展开全文”时才加载 content；折叠状态仅显示摘要/提示。

### P3-3：瀑布流更进一步的虚拟化
- 当前 `WaterfallLayout` 会对所有 subviews 做 `sizeThatFits`，当卡片数量大时仍可能有计算压力。
- 可选改为 `LazyVGrid`（牺牲严格瀑布流）或分段瀑布流（复杂）。

---

## 5. 风险与回滚策略（破坏性前提下仍建议有“开关”）

- 建议先落地 P1（容器只渲染当前源 + 可取消任务）：
  - 这是“用户可感知的卡顿/内存”最大头，且改动集中。
- P2 的去冗余会涉及更大范围重构：
  - 建议每个子项独立提交/独立 build 验证。


