# 同步任务视图迁移到工具栏 Popover（实施计划）

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将当前 Detail 中的同步任务队列（`SyncQueueView`）迁移到窗口工具栏的常驻按钮 Popover 内；按钮按状态展示灰色圆环/进度圆环/绿色对勾/红色叉。

**Non-goals（非目标）:**
- 不调整同步引擎/队列调度逻辑（仅做 UI 迁移与展示）。
- 不改动国际化资源文件（不新增/修改 strings 表）。

**Approach（方案）:**
- 在 `MainListView` 增加工具栏按钮，使用系统 `.popover`（带默认箭头）。
- 按 `SyncQueueStore.tasksPublisher` 推导按钮状态：
  - `queued/running` 存在 → 显示进度圆环（基于任务完成数；若可从 `progressText` 解析到 `n/m` 则细化）。
  - 无活动任务且有失败 → 显示红色叉。
  - 无活动任务且任务都成功 → 显示绿色对勾。
  - 队列为空 → 显示灰色圆环。
- Popover 内容复用现有 `SyncQueueView`，外层加滚动与固定尺寸。
- 从 `SelectionPlaceholderView` 移除内嵌的 “Sync Queue” 区块。

**Acceptance（验收）:**
- 工具栏常驻显示一个“同步任务”按钮（空闲为灰色圆环）。
- 同步进行中按钮显示有进度的圆环（非整圈纯色）。
- 全部完成后显示绿色对勾；存在失败则显示红色叉。
- 点击按钮出现系统 Popover，内容展示 `SyncQueueView`，可滚动。
- Detail 中不再出现 `SyncQueueView` 的入口区块。

---

## Plan A（主方案）

### Task 1: 新增工具栏按钮与状态推导

**Files:**
- Create: `SyncNos/Views/Components/Controls/SyncQueueToolbarButton.swift`
- Modify: `SyncNos/Views/Components/Main/MainListView.swift`

**Steps:**
1. 新增 `SyncQueueToolbarButton`（含状态 ViewModel、圆环绘制、Popover 容器）。
2. `MainListView` 增加 `.toolbar`，放置 `SyncQueueToolbarButton`。

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: Build SUCCESS

### Task 2: 移除 Detail（占位页）中的 Sync Queue 区块

**Files:**
- Modify: `SyncNos/Views/Components/Cards/InfoHeaderCardView.swift`

**Steps:**
1. 从 `SelectionPlaceholderView` 移除 “Sync Queue” 折叠区块与其状态存储。
2. 删除不再使用的 `SyncQueueCollapseStore`（如无其它引用）。

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: Build SUCCESS

