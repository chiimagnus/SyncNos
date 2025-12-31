### Plan A：DetailView 内存释放（不优化 List 切换性能）

### 目标（Goal）
- **只优化 DetailView / DetailViewModel 的内存占用与释放**：切换 selection / 离开 Detail 后，能快速释放“大数组/大字符串/会话资源/长任务”。
- **允许同时加载多个 ListView**：不做“切换数据源 ListView 的性能优化”。
- **绝不影响 Notion 同步**：`NotionSyncEngine` + 各 Adapter 的数据路径保持一致、可正常编译与运行。
- **接受破坏性重构**：以“删冗余、统一入口、生命周期绑定”为第一原则。

### 现状盘点（已逐文件阅读）
- **AppleBooks**
  - `Views/AppleBooks/AppleBooksDetailView.swift`：使用 `.task(id:)` 绑定 selection 生命周期。
  - `ViewModels/AppleBooks/AppleBooksDetailViewModel.swift`：已有 **可取消任务句柄** + **loadId 防串台** + **SQLite 只读 session 关闭** + `removeAll(keepingCapacity: false)`，加载侧是“理想模式”。
  - 主要风险：**Detail 内部 sync 使用 `Task {}` 强持有 VM** → 离开 Detail 后，VM 可能被同步任务续命到同步结束。

- **GoodLinks**
  - `Views/GoodLinks/GoodLinksDetailView.swift` + `ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`：已有 clear/取消任务/分页显示。
  - 主要风险：
    - **全文 content 无条件加载**：即使未展开仍把大字符串驻留内存。
    - **Detail 内部 sync `Task {}` 强持有 VM**：离开 Detail 后大数组/全文可能无法立刻释放。

- **WeRead**
  - `Views/WeRead/WeReadDetailView.swift` + `ViewModels/WeRead/WeReadDetailViewModel.swift`：缓存优先 + 后台增量同步 + 必要时全量拉取。
  - 主要风险：
    - **Detail 打开就把该书全部 highlights 拉入内存**（缓存/全量 API），分页仅用于 UI 展示，不是真分页。
    - **后台同步/全量拉取是长链路**，如果底层不配合取消，可能导致离开 Detail 后 VM 仍被任务续命。
    - `syncSmart` 也是 `Task {}` 强持有 VM。

- **Dedao**
  - `Views/Dedao/DedaoDetailView.swift` + `ViewModels/Dedao/DedaoDetailViewModel.swift`：缓存优先 + 后台 API 同步（全量 notes）。
  - 主要风险与 WeRead 类似：**全量拉取/全量入内存** + **长任务取消不确定** + **syncSmart 强持有 VM**。

- **Chats**
  - `Views/Chats/ChatDetailView.swift` + `ViewModels/Chats/ChatViewModel.swift`：已实现 **分页加载** + **切换/离开 Detail 主动 unloadMessages** + **token 防串台**，属于已达标实现。

- **Selection / 容器**
  - `Views/Components/Main/MainListView.swift` + `MainListView+DetailViews.swift`：Detail 侧基于 `contentSource` switch，只会挂载一个 DetailView；切换数据源会清空 selection。
  - 关键：**Detail 是否能立刻释放取决于 DetailVM 是否被长任务/同步任务强引用**。

---

### Plan A（按优先级）

### P1（必须做）：保证“离开 Detail 立刻可释放” + 砍掉最大内存峰值

#### P1.1 同步入口统一：从 DetailVM 迁移到 ListVM（避免 DetailVM 被 sync 续命）
- **核心策略**：Detail 里的“Sync”按钮不再调用 DetailVM 的 `syncSmart`，统一调用各 ListVM 的 `batchSync(单个ID)` 或新增 `syncOne(id:)`（内部仍走 `NotionSyncEngine` + Adapter）。
- **收益**：
  - 离开 Detail 后，DetailVM 不会被同步任务强持有 → 大数组/大字符串/会话资源可以立刻释放。
  - 删除重复的同步状态 UI（DetailVM 的 `isSyncing/syncProgressText/syncMessage` 等）与重复的通知发送点。
- **涉及文件（预计）**：
  - `Views/*/*DetailView.swift`（AppleBooks/GoodLinks/WeRead/Dedao）：Sync 按钮改为调用对应 ListVM 的同步入口。
  - `ViewModels/*/*DetailViewModel.swift`：删除或下沉 `syncSmart` 相关逻辑（保留纯 Detail 数据加载职责）。
- **风险点**：
  - 部分 Detail 目前依赖 `syncMessage/errorMessage` 弹窗；迁移后需改为监听 `SyncBookStatusChanged`（status=failed）并展示。
- **验证**：
  - `xcodebuild -scheme SyncNos -configuration Debug build`
  - 手动：打开某本书 → 点 Sync → 立刻切换/关闭 Detail → 观察 DetailVM deinit（后续 P3 会加日志）且 UI 同步进度仍能在列表/队列显示。

#### P1.2 GoodLinks 全文按需加载/按需卸载（解决最大字符串驻留）
- **核心策略**：
  - 只有当用户把全文卡片“展开”时才加载全文；折叠/切换 selection 时立刻 `content=nil` 释放大字符串。
- **涉及文件（预计）**：
  - `Views/GoodLinks/GoodLinksDetailView.swift`：`onChange(of: articleIsExpanded)` → expanded 才触发 `loadContent`；collapsed 触发 `unloadContent`。
  - `ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`：补充 `loadContentIfNeeded(for:)` / `unloadContent()`。
- **验证**：
  - `xcodebuild ... build`
  - 手动：未展开时内存不应因全文加载而飙升；展开→加载；折叠→内容释放（内存图/Allocations 观察）。

#### P1.3 WeRead/Dedao Detail 真分页（缓存分页查询 + totalCount 计数），不再“全量入内存”
- **核心策略**：
  - Detail 只保留当前已加载页的 `visibleHighlights`（以及必要的分页游标/offset）。
  - `totalFilteredCount` 通过缓存层 `count` 查询得到，而不是把全量拉出来再 count。
  - 当缓存为空时才进行 API 拉取（并写入缓存）；之后仍以缓存分页读取展示。
- **需要的基础设施（破坏性改动）**：
  - 修改 `WeReadCacheServiceProtocol` / `DedaoCacheServiceProtocol`：
    - `countHighlights(...) -> Int`
    - `fetchHighlightsPage(...limit, offset, sort, filters...) -> [DTO]`
  - 修改实现：
    - `Services/DataSources-From/WeRead/WeReadCacheService.swift`
    - `Services/DataSources-From/Dedao/DedaoCacheService.swift`
  - 修改调用方：
    - `ViewModels/WeRead/WeReadDetailViewModel.swift`（重写为分页模型）
    - `ViewModels/Dedao/DedaoDetailViewModel.swift`（重写为分页模型）
    - `Services/DataSources-From/WeRead/WeReadIncrementalSyncService.swift`：用 `countHighlights` 替换 `getHighlights().count`，避免同步阶段全量拉取进内存。
- **过滤/排序策略（建议落地）**：
  - WeRead：
    - `noteFilter`：`note != nil && note != ""` **或** `reviewContentsJSON != nil`（模型已具备 `reviewContentsJSON` 字段，适合做 predicate）。
    - `selectedStyles`：尽量在 predicate 层过滤 `colorIndex`，不支持则退化为“页内过滤 + 逐步补齐页容量”。
    - `sort`：仅 `.created`（已满足）。
  - Dedao：
    - `noteFilter`：`note != nil && note != ""`
    - `sort`：`.created/.modified` 分别映射 `createdAt/updatedAt`（`updatedAt` 为空则回退 `createdAt`）。
- **验证**：
  - `xcodebuild ... build`
  - 手动：打开高亮很多的书（数千条），Detail 内存不应一次性加载所有；滚动到尾部才逐页加载；切换/离开 Detail 后，已加载页释放。

#### P1.4 Detail 数据加载任务：全部改为“可取消句柄 + token 防串台 + clear()”
- **核心策略**：
  - 所有 DetailVM 统一提供：
    - `clear()`：取消任务、清空大数组/大字符串、关闭 session（如有）
    - `currentLoadTask` + `currentLoadId`：防止旧任务回写
  - 在 DetailView 中：
    - `.task(id:)` 开始前先 `clear()`（或 VM 内部自动 clear）
    - `.onDisappear` 强制 `clear()`（即使 selection 未变也释放）
- **涉及文件（预计）**：
  - `ViewModels/WeRead/WeReadDetailViewModel.swift`
  - `ViewModels/Dedao/DedaoDetailViewModel.swift`
  - `ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`（补 `deinit { cancel }` 兜底）
  - 对应 `Views/*DetailView.swift`
- **验证**：
  - `xcodebuild ... build`
  - 手动：快速连续切换 selection（10 次以上）不串台；离开 Detail 内存可回收。

---

### P2（应该做）：进一步降内存 + 删除重复实现

#### P2.1 抽象统一的分页器/生命周期组件（减少重复代码）
- 抽出可复用的分页状态与“loadMoreIfNeeded”逻辑（AppleBooks/GoodLinks/WeRead/Dedao 目前大量重复）。
- 用组合（而不是继承）实现，例如：
  - `PagedResultsController`（负责 offset/limit/token/cancel）
  - `DetailMemoryPolicy`（负责 clear/unload 策略）

#### P2.2 统一高亮筛选/排序偏好（UserDefaults + Notification）
- 当前 AppleBooks/GoodLinks/WeRead/Dedao 维护多套 key，且逻辑重复。
- 统一为一个 `HighlightPreferencesStore`（集中读写 key、集中发通知），各 DetailVM 只订阅并应用。

#### P2.3 清理死代码与重复工具函数
- 例：`DedaoDetailViewModel.cachedToNote(_:)` 若无引用则删除。
- `GoodLinksDetailView.formatDate` 改为静态 formatter，避免频繁创建。
- 梳理重复的 Notification.Name 字符串，集中定义（避免 typo 与重复发送点）。

---

### P3（可选）：加“可观察性”与回归清单

#### P3.1 Debug 可观察性
- 为每个 DetailVM 增加 `deinit` 日志（仅 Debug），用于确认是否真正释放。
- 为分页加载/clear/cancel 打点（logger debug），用于定位“续命”来源。

#### P3.2 回归清单（不依赖网络）
- 编译回归：`xcodebuild -scheme SyncNos -configuration Debug build`
- 行为回归（手动）：
  - AppleBooks：分页加载/切换书籍/离开 detail
  - GoodLinks：展开/折叠全文、滚动加载高亮、离开 detail
  - WeRead/Dedao：大量高亮分页、筛选/排序后分页重置、离开 detail
  - Chats：切换对话/离开 detail 仍卸载消息
  - Notion：确保各 `*NotionAdapter` 仍可编译（同步路径不被破坏）

