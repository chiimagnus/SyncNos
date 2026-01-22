# 逻辑态“全选”（保留分页）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 保留现有分页/增量加载（`pageSize = 80`），实现真正的 Cmd+A「全选」：批量操作以“逻辑全选”驱动（基于 `display*` 全量集合），UI 仅对已加载/已渲染项显示选中状态，并支持“排除少数”（全选后取消选中某些条目）。

**Non-goals（非目标）:**
- 不改变分页策略/`pageSize`，不强制一次性渲染全量列表。
- 不引入新的同步策略/队列逻辑，不改 Notion 同步引擎行为。
- 不把“全选”做成跨数据源的全选（只作用于当前数据源）。

**Approach（方案）:**
- 将选择状态从 “`Set<String>`（显式选中）” 升级为 “选择模式（显式/全选）+ 排除集合”。
- `List(selection:)` 只绑定“当前可见范围”的选中集合（UI 态），避免把上千 ID 写进 binding 导致 SwiftUI 折叠回 80 的问题。
- 批量操作（Sync / Full Resync 等）改为从“逻辑选择”解析出最终 ID 集合：`allIds - excluded` 或 `explicitSelected`。

**Acceptance（验收）:**
- 在 AppleBooks/GoodLinks/WeRead/Dedao/Chats 任一列表中，`Cmd+A` 后：
  - 不会只选中 80 个（批量操作范围应等于 `display*` 的全量数量，可被日志/占位视图计数验证）。
  - UI 上当前已加载的行全部显示为选中；向下滚动触发分页加载后，新加载的行也应自动显示为选中（除非被排除）。
- 全选后点击某一行取消选中：该行进入“排除集合”，批量操作不应包含该行；再次选中则从排除集合移除。
- `Esc`（Deselect）能清除当前数据源选择（退出“全选模式”，显式集合清空）。
- `xcodebuild -scheme SyncNos build` 通过。

---

## Plan A（主方案）

### P1（最高优先级）：引入“逻辑选择模型”

#### Task 1: 在 `SelectionState` 中引入选择模式（显式/全选+排除）

**Files:**
- Modify: `SyncNos/Models/Core/SelectionState.swift`

**Step 1: 增加内部模型**
- 新增一个内部存储结构（示例）：
    - `enum SelectionMode { case explicit(Set<String>); case all(excluding: Set<String>) }`
    - `private var selections: [ContentSource: SelectionMode]`

**Step 2: 新增面向业务的 API（逻辑态）**
- 增加这些方法（命名可按现有风格微调）：
    - `func setAllSelected(for source: ContentSource)`（进入全选模式，清空排除）
    - `func clearSelection(for source: ContentSource)`（回到显式空集合）
    - `func isAllSelected(for source: ContentSource) -> Bool`
    - `func excludedIds(for source: ContentSource) -> Set<String>`（仅当全选模式）
    - `func logicalSelectedIds(for source: ContentSource, allIds: Set<String>) -> Set<String>`
    - `func logicalSelectedCount(for source: ContentSource, totalCount: Int) -> Int`

**Step 3: 保持现有单选相关 API 的语义明确**
- `singleSelectedId(for:)` / `hasSingleSelection(for:)` 建议仅对 `.explicit` 生效；对 `.all` 返回 `nil/false`（避免在“全选”状态进入 Detail）。

**Step 4:（关键）为 `List(selection:)` 提供“范围绑定（UI 态）”**
- 将现有 `selectionBinding(for:)` 替换为（示例）：
    - `func selectionBinding(for source: ContentSource, scopeIds: @escaping () -> [String]) -> Binding<Set<String>>`
- 绑定语义：
    - **get**：返回该 `scopeIds` 中哪些应该显示为选中（显式集合 or 全选-排除）。
    - **set**：只更新该 `scopeIds` 范围内的变化：
        - `.explicit`：`explicit = (explicit - scopeSet) ∪ newSelection`
        - `.all(excluding)`：`excluding = (excluding - scopeSet) ∪ (scopeSet - newSelection)`

**Validation:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: 编译通过（此时还未替换调用点，可能会因签名变更失败；失败即进入 Task 2/3 修复调用点）。

---

### P1：让 Cmd+A 进入“逻辑全选”，而不是往 `List` 塞全量 Set

#### Task 2: 调整 `SelectionCommands` 的 `selectAll/deselectAll` 行为

**Files:**
- Modify: `SyncNos/Views/Commands/SelectionCommands.swift`（如需扩展命令签名）
- Modify: `SyncNos/Views/Components/Controls/SwipeableDataSourceContainer.swift`

**Step 1: 定义 SelectionCommands 的能力边界**
- 目标：`selectAll()` 不再调用 `selectionState.setSelection(... allIds ...)`，而是调用 `selectionState.setAllSelected(for:)`。
- `deselectAll()` 调用 `selectionState.clearSelection(for:)`。

**Step 2: `SwipeableDataSourceContainer` 提供“当前数据源的全量 allIds（display*）”**
- 这里仍然需要 `allIds/totalCount`，用于：
    - `canSelectAll/canDeselect` 的状态计算
    - 批量操作的逻辑选择解析（后续会在 MainListView 中使用）

**Step 3: 更新列表 selection binding 调用点**
- 把：
  - `selectionState.selectionBinding(for: .appleBooks)`
  - 替换为：
  - `selectionState.selectionBinding(for: .appleBooks, scopeIds: { appleBooksVM.visibleBooks.map(\.bookId) })`
- 同理替换 GoodLinks / WeRead / Dedao / Chats（Chats 没分页，但仍可使用 `contacts.map(\.id)` 作为 scope）。

**Validation:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: 编译通过。

---

### P1：批量操作全部改用“逻辑选择”

#### Task 3: 将 Sync / Full Resync 的选中集合改为逻辑态解析（基于 `display*`）

**Files:**
- Modify: `SyncNos/Views/Components/Main/MainListView+SyncRefresh.swift`
- Modify: `SyncNos/Views/Components/Main/MainListView+DetailViews.swift`

**Step 1: 在 MainListView 扩展中集中构造 `allIds`（按当前数据源）**
- 新增一个私有 helper（示例签名）：
    - `private func allIdsForCurrentSource() -> Set<String>`
- 约定使用 `display*`（过滤后的全量）而不是 `visible*`：
    - AppleBooks：`Set(appleBooksVM.displayBooks.map(\.bookId))`
    - GoodLinks：`Set(goodLinksVM.displayLinks.map(\.id))`
    - WeRead：`Set(weReadVM.displayBooks.map(\.bookId))`
    - Dedao：`Set(dedaoVM.displayBooks.map(\.bookId))`
    - Chats：`Set(chatsVM.contacts.map(\.id))`

**Step 2: 替换所有 `selectionState.selection(for:)` 的“批量用途”**
- 在这些入口，将 `selectedIds` 改为：
  - `let allIds = allIdsForCurrentSource()`
  - `let selectedIds = selectionState.logicalSelectedIds(for: contentSource, allIds: allIds)`
- 典型位置：
    - `syncSelectedForCurrentSource()`
    - `fullResyncSelectedForCurrentSource()`
    - `MainListView+DetailViews.swift` 里 `syncSelectedXxx()`（如果保留这些 wrapper）

**Step 3: Full Resync 的 title lookup 使用 display 集合（与过滤一致）**
- 当前实现用 `books/links` 查 title；建议改为用 `display*` 查（保证“筛选后全选”的一致性）。

**Validation:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual: 选中一部分（显式模式）后触发 “Sync Selected to Notion”，应只同步所选；Cmd+A 后触发同步，应同步 `display*` 全量（可通过日志中 acceptedIds 数量观察）。

---

### P1：UI 入口全部走“集中同步”以避免 contextMenu 只拿到可见 selection

#### Task 4: 列表 context menu 的 “Sync Selected to Notion” 改为发通知（或注入闭包）

**Files:**
- Modify: `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksListView.swift`
- Modify: `SyncNos/Views/WeRead/WeReadListView.swift`
- Modify: `SyncNos/Views/Dedao/DedaoListView.swift`
- Modify: `SyncNos/Views/Chats/ChatListView.swift`

**Step 1: 替换直接调用 ViewModel.batchSync(selectionIds)**
- 把 context menu 里的：
    - `viewModel.batchSync(... selectionIds ...)`
  改为：
    - `NotificationCenter.default.post(name: .syncSelectedToNotionRequested, object: nil)`
- 这样无论显式/全选，都会走 `MainListView.syncSelectedForCurrentSource()`，使用逻辑选择。

**Step 2:（可选）禁用条件改为逻辑态**
- 如果需要保留 `.disabled(...)`：
    - 引入 `SelectionState` 的 `logicalSelectedCount(...)` 或 `hasLogicalSelection(...)`，避免仅依赖 `selectionIds.isEmpty`。

**Validation:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual: Cmd+A 后右键菜单触发同步，应同步全量而非 80。

---

### P2：菜单可用性与占位视图计数优化（可选但推荐）

#### Task 5: 让占位视图/菜单显示“逻辑选中数量”

**Files:**
- Modify: `SyncNos/Views/Components/Main/MainListView+DetailViews.swift`
- Modify: `SyncNos/Views/Components/Controls/SwipeableDataSourceContainer.swift`

**Step 1: Placeholder 中 `count` 使用 `logicalSelectedCount`**
- 现在 `count` 取的是 `selectionState.selection(for:).count`，在全选模式会不准确（仅可见）。
- 替换为：`selectionState.logicalSelectedCount(for: source, totalCount: filteredCount)` 并在 `0` 时传 `nil`。

**Step 2: `canDeselect/canSelectAll` 使用逻辑态判断**
- `canDeselect`: 逻辑选中数量 > 0
- `canSelectAll`: 逻辑选中数量 < totalCount

**Validation:**
- Run: `xcodebuild -scheme SyncNos build`

---

## 回归验证（每完成一个 P 分组都建议跑）

- Build: `xcodebuild -scheme SyncNos build`
- 手动回归（至少 AppleBooks + GoodLinks）：
  - 列表超过 80 条时 Cmd+A → 右侧占位视图计数 = `display*` 数量
  - 向下滚动加载更多：新加载行默认显示选中
  - 取消选中某一行：再次同步不包含该行
  - Esc：清空选择，回到未选中状态

---

## 不确定项（执行前确认，避免返工）

1. “全选”是否需要尊重当前筛选（`display*`）？本计划默认 **尊重筛选**（更符合用户预期）。
2. “全选”状态下是否允许进入 Detail（单选）？本计划默认 **不允许**（保持行为简单且避免错误进入）。
3. Chats 是否需要分页？当前 contacts 未分页，本计划仍可复用“逻辑全选”模型，但 scope 等于全部 contacts。

