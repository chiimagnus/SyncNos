# ContextMenu 按钮组件化实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将多个 `ListView` 行右键菜单中重复的 `Button/Divider/Text` 片段抽成可复用组件，减少重复代码并保证行为一致（不改国际化字段）。

**Non-goals（非目标）:**
- 不修改任何 `Resource/Localizable.xcstrings`（除非你明确要求）。
- 不更改 Notion 同步逻辑/数据结构（只做 UI 复用层的收敛）。
- 不对各数据源的业务行为做“统一化重构”（避免引入不必要耦合）。

**Approach（方案）:**
- 以 `NotionOpenContextMenuItem` 的做法为范例：把“菜单项/菜单分组”抽成独立 `View` 组件。
- 对于“行为一致、只需要输入参数不同”的部分：做成可复用组件（例如 Last Sync Time 分组）。
- 对于“行为不完全一致”的部分：只收敛 UI（Label/Divider/disabled），把 action 通过 closure 注入，避免把具体 ViewModel 绑死在组件里。

**Acceptance（验收）:**
- `xcodebuild -scheme SyncNos build` 成功。
- 下列重复片段被替换为组件引用（每处替换后行为/文案不变）：
  - `Last Sync Time` 的 context menu 展示（AppleBooks / GoodLinks / WeRead / Dedao）。
  - `Sync Selected to Notion` 的 context menu 项（AppleBooks / GoodLinks / WeRead / Dedao / Chats）。
  - `Open in Apple Books` / `Open in GoodLinks` 的 context menu 项（对应列表）。

---

## 需要更新的重复点（Inventory）

### A. List 行右键菜单：Last Sync Time（重复 4 处）
- `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- `SyncNos/Views/GoodLinks/GoodLinksListView.swift`
- `SyncNos/Views/WeRead/WeReadListView.swift`
- `SyncNos/Views/Dedao/DedaoListView.swift`

### B. List 行右键菜单：Sync Selected to Notion（重复 5 处 + Commands 1 处）
- `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- `SyncNos/Views/GoodLinks/GoodLinksListView.swift`
- `SyncNos/Views/WeRead/WeReadListView.swift`
- `SyncNos/Views/Dedao/DedaoListView.swift`
- `SyncNos/Views/Chats/ChatListView.swift`
- （可选）`SyncNos/Views/Settings/Commands/FileCommands.swift`（这是菜单栏 Commands，不是 contextMenu，可单独评估是否要收敛）

### C. List 行右键菜单：Open in …（重复 2 处）
- `SyncNos/Views/AppleBooks/AppleBooksListView.swift`（Open in Apple Books）
- `SyncNos/Views/GoodLinks/GoodLinksListView.swift`（Open in GoodLinks）

### D. Chats 消息右键菜单（已组件化，无需改）
- `SyncNos/Views/Chats/Components/ChatMessageBubble.swift` / `ChatSystemMessageRow.swift` 已通过 `ChatMessageContextMenu` 收敛

---

## Plan A（主方案）

### P1：抽取 “Last Sync Time” 分组组件

### Task 1: 新增 `LastSyncTimeContextMenuSection`

**Files:**
- Create: `SyncNos/Views/Components/ContextMenus/LastSyncTimeContextMenuSection.swift`

**Step 1: 创建组件（只做 UI 展示，不绑定任何 VM）**
- API 建议：`init(lastSyncAt: Date?)`
- 组件内部包含：`Divider()` + `Text("Last Sync Time") + ...`

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

### Task 2: 替换 4 个 ListView 的重复片段

**Files:**
- Modify: `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksListView.swift`
- Modify: `SyncNos/Views/WeRead/WeReadListView.swift`
- Modify: `SyncNos/Views/Dedao/DedaoListView.swift`

**Step 1: 用 `LastSyncTimeContextMenuSection(lastSyncAt: viewModel.lastSync(for: ...))` 替换原有 `Divider + Text` 片段**

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

---

### P1：抽取 “Sync Selected to Notion” 菜单项组件（UI 统一 + action 注入）

### Task 3: 新增 `SyncSelectedToNotionContextMenuItem`

**Files:**
- Create: `SyncNos/Views/Components/ContextMenus/SyncSelectedToNotionContextMenuItem.swift`

**Step 1: 创建组件**
- API 建议：
  - `init(isDisabled: Bool = false, action: @escaping () -> Void)`
  - Label 固定：`Label("Sync Selected to Notion", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")`

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

### Task 4: 替换 5 个 ListView 的 “Sync Selected to Notion” Button

**Files:**
- Modify: `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksListView.swift`
- Modify: `SyncNos/Views/WeRead/WeReadListView.swift`
- Modify: `SyncNos/Views/Dedao/DedaoListView.swift`
- Modify: `SyncNos/Views/Chats/ChatListView.swift`

**Step 1: 替换为组件调用**
- AppleBooks / WeRead / Dedao / GoodLinks：disabled 逻辑可先保持现状（默认不禁用），或按需求逐个补齐。
- Chats：保留现有 `.disabled(...)` 条件，作为 `isDisabled` 传入组件。

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

---

### P2：抽取 “Open in …” 菜单项（可选，但能进一步减少重复）

### Task 5: 新增通用 `OpenURLContextMenuItem`

**Files:**
- Create: `SyncNos/Views/Components/ContextMenus/OpenURLContextMenuItem.swift`

**Step 1: 创建组件**
- API 建议：`init(title: String, systemImage: String, url: URL?)`
- 行为：`url != nil` 才显示/或显示但 disabled（二选一，建议“url 为空就不渲染”以保持现状）

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

### Task 6: 替换 AppleBooks/GoodLinks ListView 的 Open in… 片段

**Files:**
- Modify: `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksListView.swift`

**Step 1: 用 `OpenURLContextMenuItem(...)` 替换原有 `if let url { Button { NSWorkspace.open(url) } ... }`**

**Step 2: 验证编译**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: PASS

---

## 回归验证（每完成一个优先级分组）

- Run: `xcodebuild -scheme SyncNos build`

---

## 不确定项（执行前确认）

- `Sync Selected to Notion` 是否希望在所有 ListView 都统一 disabled 逻辑（例如 `selectionIds.isEmpty` 时禁用）？还是保持各自现状不动？
- `OpenURLContextMenuItem` 在 url 为空时的处理策略：隐藏（保持现状） vs 显示但禁用（更可发现但改变 UI）。

