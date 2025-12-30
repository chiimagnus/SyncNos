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

## 当前代码状态（基于 2025-12-30 最新代码）

### 已确认落地的关键内存治理策略（✅）

- **生命周期绑定加载**：
  - AppleBooks/GoodLinks/WeRead/Dedao：Detail 加载已统一使用 `.task(id:)` 绑定到 selectionId。
  - Chats：首次消息加载使用 `.task(id: contactId)`，并且在切换对话/离开 Detail 时卸载已加载消息。
- **可取消加载 + 过期结果丢弃**：
  - AppleBooks：`currentLoadTask` 指向真正的可取消 fetch task，并用 `currentLoadId` 避免“旧任务回写新状态”；切书时 `session.close()` + `removeAll(keepingCapacity:false)`。
  - GoodLinks：`highlightsFetchTask` / `contentFetchTask` 可取消，且用 `currentLinkId` 丢弃过期结果；`clear()` 会释放数组 capacity 并置空 `content`。
  - WeRead/Dedao：加载逻辑在同一个 async task 内串行执行（缓存 → 后台同步），并在关键节点用 `Task.isCancelled` + `currentBookId == bookId` 避免过期回写。
  - Chats：分页加载使用 `paginationLoadTokens` 防串台；`unloadMessages` 会先失效 token 再清空数组，避免“旧任务把消息复活”。
- **主动释放大数组的 capacity**：
  - 已普遍改为 `removeAll(keepingCapacity:false)`（AppleBooks/GoodLinks/WeRead/Dedao/Chats）。
- **Chats 已完成“只保留 metadata，消息懒加载”**：
  - `ChatViewModel` 不再持有 `conversations[UUID].messages` 这类双份结构；导出“当前看到的数据”优先使用分页消息，“导出全部”从缓存拉全量（用户主动动作允许一次性峰值）。

### 仍值得关注 / 尚未完全解决的点（⚠️）

#### 1) GoodLinks 全文内容依然是“进入详情就加载 + 折叠也常驻”（已明确取消 P2.1）

- `GoodLinksDetailView` 会在 `.task(id:)` 中同时调用 `loadHighlights` + `loadContent`。
- `ArticleContentCardView` 的“折叠/展开”仅改变 `lineLimit`，**不会释放** `contentText` 的内存占用。

**风险**：当某些文章 content 极大时，Detail 峰值仍会被“全文字符串”撑高，即使 UI 处于折叠态。

**决策**：该优化项（P2.1：延迟加载/折叠释放）已按当前需求评估并 **明确取消**，后续不再推进。

#### 2) 少量非生命周期绑定的 `Task { ... }` 仍存在（低优先级）

- 例如 GoodLinks 的 `RefreshBooksRequested` 监听里会启动 unstructured `Task { ... }`。
- 这类任务若在触发后用户快速切换/退出 Detail，可能短暂延迟 detailViewModel 的 deinit（直到任务结束/被 ViewModel 内部取消）。

#### 3) WeRead/Dedao 仍会持有 `allHighlights` + `filteredHighlights` + `visibleHighlights`（可选优化）

- 目前已避免“原始模型 + 展示模型”双份持有，但依然存在展示模型在不同数组间的复制（可通过“索引过滤/按需 slice”进一步降低峰值）。

---

## Plan A（以“当前代码真实状态”为基准）

### P1（已完成）：让 Detail “能退出、能取消、能释放”

> 下面条目为“Plan A 的核心兜底策略”。在最新代码中，这些已完成并可作为未来新增数据源/新 Detail 的硬规范。

- [x] **P1.1 生命周期绑定加载**：Detail 加载统一用 `.task(id:)` 绑定 selectionId（或同等语义的可取消任务）。
- [x] **P1.2 AppleBooks 真取消 + 真清理**：可取消 fetch task + `session.close()` + `removeAll(keepingCapacity:false)` + 过期结果丢弃。
- [x] **P1.3 GoodLinks 可取消 + 过期结果丢弃 + 清理容量**：`highlightsFetchTask`/`contentFetchTask` + `currentLinkId` 校验 + `clear()` 释放。
- [x] **P1.4 WeRead/Dedao 串行任务 + 过期结果丢弃 + 清理容量**：缓存优先 + 后台同步（同 task 内）+ `Task.isCancelled` 与 bookId 校验。
- [x] **P1.5 Chats 激进释放**：切换对话/离开 Detail 时卸载已加载消息；分页任务用 token 防串台。
- [x] **P1.6 宽度 debounce 任务清理**：各 Detail 在 `onDisappear` cancel `layoutWidthDebounceTask`。

#### P1 验证（建议保留为“回归步骤”）

1. `xcodebuild -scheme SyncNos -configuration Debug build`
2. 手工验证（建议步骤）：
   - 快速在同一数据源内切换不同条目（书/文章/对话），观察是否出现旧内容回写/闪回
   - 切换数据源 → 再切回 → 确认 Detail 重新加载且不会崩溃
   - 退出某 Detail（让右侧变为 placeholder）→ 再进入 → 确认加载正常

---

### P2（可选）：进一步降峰值（当前仅保留“可选项”）

> 说明：P2.1（GoodLinks 全文延迟加载/折叠释放）已明确取消；P2.4（抽象复用）也已明确取消。

#### P2.2 WeRead/Dedao：进一步降低展示模型复制（可选）

现状：已避免“原始模型 + 展示模型”双份持有（✅），但仍有 `allHighlights`/`filteredHighlights`/`visibleHighlights` 的复制。

可选方向：

- 使用“索引数组”表达筛选结果：`filteredIndices: [Int]`，并用 indices 生成可见页，减少复制。
- 或仅保留 `allHighlights`，`visibleHighlights` 通过 slice + 即时过滤/排序生成（注意性能权衡）。

#### P2.3 Chats：保持“消息懒加载 + 离开即卸载”的策略（已完成 ✅）

继续的约束：

- 对话列表不要再引入任何“常驻 messages 数组”
- “导出全部”允许一次性峰值，但必须是用户显式触发

---

### P3（可选）：渲染/布局优化（极大数据时更明显）

#### P3.1 `WaterfallLayout` 加缓存（Layout cache）避免频繁全量 sizeThatFits

文件：`WaterfallLayout.swift`

- 使用 Layout 的 `Cache` 存储上次计算结果（positions/columnWidth/height）
- 仅当宽度/子视图数量变化时重算

#### P3.2 进一步虚拟化

如果未来出现“单条目高亮上千条”的极端场景：

- 考虑用 `LazyVGrid` + 分页（替代 waterfall），或改用 `List`（macOS 更成熟的复用机制）

---

## 执行顺序建议（强约束：每完成一个 P 就 build）

1. P1 已完成：作为“硬规范”长期保留
2. 如未来需要进一步降峰值：优先评估 P2.2（WeRead/Dedao 进一步降峰值）→ **build**
3. 最后视情况做 P3 → **build**

