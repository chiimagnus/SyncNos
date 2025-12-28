# ListView / DetailView 焦点状态修复计划

## 问题描述

当使用**鼠标点击** DetailView 时，ListView 的选中项高亮颜色**不会**从强调色（蓝色）变为灰色。
而使用**键盘左右方向键**导航时，高亮颜色**正确变化**。

### 期望行为
- 焦点在 ListView → 选中项高亮为**强调色**（蓝色）
- 焦点在 DetailView → 选中项高亮为**灰色**

### 实际行为
- 键盘导航：✅ 正确变化
- 鼠标点击：❌ 高亮颜色不变，始终为强调色

---

## 问题分析

### 涉及的关键文件

| 文件 | 作用 |
|------|------|
| `MainListView.swift` | 主分栏视图，管理 `keyboardNavigationTarget` 状态 |
| `MainListView+KeyboardMonitor.swift` | 键盘/鼠标事件监视器 |
| `AppleBooksListView.swift` | Apple Books 列表，持有 `@FocusState isListFocused` |
| `GoodLinksListView.swift` | GoodLinks 列表 |
| `WeReadListView.swift` | WeRead 列表 |
| `DedaoListView.swift` | Dedao 列表 |
| `ChatListView.swift` | Chats 列表 |
| `EnclosingScrollViewReader.swift` | 获取底层 NSScrollView 的工具 |

### 根本原因

1. **两套独立的状态系统**
   - `MainListView.keyboardNavigationTarget: NavigationTarget`（Swift 枚举）
   - 各 ListView 的 `@FocusState private var isListFocused: Bool`（SwiftUI 状态）
   - 这两者**没有绑定关系**

2. **键盘导航的正确流程**
   ```
   keyDown 事件 (← / →)
       ↓
   MainListView+KeyboardMonitor.swift
       ↓
   window.makeFirstResponder(responder)  ← 关键：直接改变 AppKit firstResponder
       ↓
   AppKit 更新 firstResponder
       ↓
   SwiftUI @FocusState 自动同步
       ↓
   List 高亮颜色变化
   ```

3. **鼠标点击的错误流程**
   ```
   leftMouseDown 事件
       ↓
   MainListView+KeyboardMonitor.swift
       ↓
   syncNavigationTargetWithFocus()
       ↓
   keyboardNavigationTarget = .detail  ← 只更新了 Swift 变量
       ↓
   ❌ 没有调用 makeFirstResponder
       ↓
   ❌ AppKit firstResponder 未改变
       ↓
   ❌ @FocusState 未更新
       ↓
   ❌ List 高亮颜色不变
   ```

### macOS List 高亮行为

macOS 的 NSTableView/NSOutlineView（SwiftUI List 的底层）有内置行为：
- 当表格是 firstResponder 时 → 选中行高亮为**强调色**
- 当表格失去 firstResponder 时 → 选中行高亮变为**灰色**

SwiftUI 的 `@FocusState` 是对 AppKit firstResponder 状态的**反映**，而不是**控制**。

---

## 修复方案

### P1（必须修复）：鼠标点击 DetailView 时触发焦点变化

#### 方案 A：在鼠标点击事件中调用 makeFirstResponder（推荐）

**修改文件**：`MainListView+KeyboardMonitor.swift`

**当前代码**（`leftMouseDown` 处理）：
```swift
func startMouseDownMonitorIfNeeded() {
    // ... 现有逻辑 ...
    // 目前只调用 syncNavigationTargetWithFocus()
}
```

**修改方案**：
```swift
func startMouseDownMonitorIfNeeded() {
    guard mouseDownMonitor == nil else { return }
    mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
        guard let self = self else { return event }
        
        // 获取点击位置
        guard let window = event.window else { return event }
        let locationInWindow = event.locationInWindow
        
        // 判断点击是否在 DetailView 区域
        if let detailScrollView = self.currentDetailScrollView,
           let detailFrame = detailScrollView.superview?.convert(detailScrollView.frame, to: nil),
           detailFrame.contains(locationInWindow) {
            // 点击在 DetailView → 将焦点转移到 DetailView
            DispatchQueue.main.async {
                self.keyboardNavigationTarget = .detail
                // 关键：让 DetailView 的 ScrollView 成为 firstResponder
                window.makeFirstResponder(detailScrollView)
            }
        } else {
            // 点击在 ListView 区域 → 将焦点转移到 ListView
            // ListView 会自动成为 firstResponder（通过 List 的内置行为）
        }
        
        return event
    }
}
```

**优点**：
- 最小化改动
- 利用已有的 `currentDetailScrollView` 引用
- 与键盘导航行为一致

**缺点**：
- 需要准确判断点击区域

#### 方案 B：使用 SwiftUI 的 .onTapGesture

**修改文件**：各 DetailView（`AppleBooksDetailView.swift` 等）

```swift
// 在 DetailView 的主容器添加
.contentShape(Rectangle())
.onTapGesture {
    // 通知 MainListView 焦点已转移到 detail
    NotificationCenter.default.post(
        name: Notification.Name("DetailViewTapped"),
        object: nil
    )
}
```

**修改文件**：`MainListView.swift`

```swift
.onReceive(NotificationCenter.default.publisher(for: Notification.Name("DetailViewTapped"))) { _ in
    keyboardNavigationTarget = .detail
    // 触发 firstResponder 变化
    if let scrollView = currentDetailScrollView,
       let window = scrollView.window {
        window.makeFirstResponder(scrollView)
    }
}
```

**优点**：
- 解耦，DetailView 不需要知道 ListView 的存在

**缺点**：
- 可能影响 DetailView 内其他点击交互（如按钮）
- 需要修改多个文件

#### 方案 C：移除 mouseDownMonitor，完全依赖 AppKit 的 firstResponder 机制

**思路**：不主动监控鼠标点击，而是监控 `NSWindow` 的 `firstResponderDidChange` 通知。

**修改文件**：`MainListView+KeyboardMonitor.swift`

```swift
func startFirstResponderObserver() {
    NotificationCenter.default.addObserver(
        forName: NSWindow.didBecomeKeyNotification,
        object: nil,
        queue: .main
    ) { [weak self] _ in
        self?.checkAndUpdateNavigationTarget()
    }
    
    // 监听 firstResponder 变化（需要通过 window 的代理或 KVO）
}

private func checkAndUpdateNavigationTarget() {
    guard let window = NSApp.keyWindow,
          let responder = window.firstResponder else { return }
    
    // 判断 firstResponder 是 ListView 还是 DetailView
    if isResponderInDetailView(responder) {
        keyboardNavigationTarget = .detail
    } else {
        keyboardNavigationTarget = .list
    }
}
```

**优点**：
- 最自然的解决方案，完全跟随 AppKit 行为

**缺点**：
- 需要更复杂的视图层级判断
- NSWindow 没有直接的 "firstResponderDidChange" 通知

### 推荐方案：P1 采用方案 A

方案 A 是最直接、改动最小的解决方案。

---

### P2（改进）：统一焦点管理逻辑

#### 目标
将分散在各处的焦点管理逻辑统一到一个地方。

#### 当前问题
- 各 ListView 有独立的 `@FocusState isListFocused`
- `MainListView` 有 `keyboardNavigationTarget`
- 这两者没有同步

#### 改进方案

1. **移除各 ListView 中的 `@FocusState isListFocused`**
2. **在 `MainListView` 中管理统一的焦点状态**
3. **通过 `@Binding` 将焦点状态传递给子视图**

```swift
// MainListView.swift
@State private var listFocused: Bool = true

// 传递给 ListView
AppleBooksListView(
    viewModel: appleBooksVM,
    selectionIds: $selectedBookIds,
    isListFocused: $listFocused  // 新增绑定
)
```

```swift
// AppleBooksListView.swift
@Binding var isListFocused: Bool
// 或者使用 FocusedValue
```

**风险**：改动较大，可能引入新问题。

---

### P3（可选）：增强视觉反馈

#### 目标
除了高亮颜色变化，添加其他视觉反馈。

#### 可能的增强
- 添加细微的阴影变化
- 添加焦点指示器（如侧边蓝色条）
- 添加过渡动画

---

## 实施步骤

### 第一阶段：P1 实现（方案 A）

1. **修改 `MainListView+KeyboardMonitor.swift`**
   - 更新 `startMouseDownMonitorIfNeeded()` 函数
   - 在 `leftMouseDown` 事件中判断点击区域
   - 如果点击在 DetailView，调用 `window.makeFirstResponder(detailScrollView)`

2. **测试验证**
   - 键盘左右导航 → 高亮颜色正确变化
   - 鼠标点击 DetailView → 高亮颜色变灰
   - 鼠标点击 ListView → 高亮颜色变蓝
   - 所有数据源（AppleBooks、GoodLinks、WeRead、Dedao、Chats）都正常

### 第二阶段：P2 实现（可选）

1. 评估 P1 修复后的代码质量
2. 如果认为需要重构焦点管理，按 P2 方案执行

---

## 相关代码引用

### MainListView+KeyboardMonitor.swift 关键代码

```swift
// 当前 keyDown 处理（正确触发焦点变化）
if keyCode == kVK_RightArrow {
    if keyboardNavigationTarget == .list {
        keyboardNavigationTarget = .detail
        // ✅ 关键：调用了 makeFirstResponder
        if let scrollView = currentDetailScrollView {
            window.makeFirstResponder(scrollView)
        }
    }
}

// 当前 leftMouseDown 处理（缺少 makeFirstResponder 调用）
func syncNavigationTargetWithFocus(_ window: NSWindow? = nil) {
    // ❌ 只更新了 keyboardNavigationTarget，没有调用 makeFirstResponder
}
```

### 各 ListView 的 @FocusState

```swift
// AppleBooksListView.swift (及其他 ListView)
@FocusState private var isListFocused: Bool

// 在 List 上应用
.focused($isListFocused)
```

---

## 预估工作量

| 阶段 | 任务 | 预估时间 |
|------|------|----------|
| P1 | 修改鼠标事件处理 | 30 分钟 |
| P1 | 测试所有数据源 | 20 分钟 |
| P2 | 重构焦点管理（可选） | 2-3 小时 |
| P3 | 视觉增强（可选） | 1-2 小时 |

---

## 文档更新

完成修复后需更新：
- `CLAUDE.md`：如有架构变化
- 本计划文档：标记已完成的任务

---

## 创建日期
2025-12-28

## 状态
🟡 待实施

