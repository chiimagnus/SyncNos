# SyncNos 键盘导航技术文档

# 概述

SyncNos 实现了完整的键盘导航功能，允许用户在 List 和 Detail 视图之间切换，并在 Detail 视图中进行滚动操作。

## 模块分离 (v0.9.11)

从 v0.9.11 开始，键盘导航和焦点管理的代码已分离为两个独立的扩展文件：

| 文件 | 职责 |
|------|------|
| `MainListView+KeyboardMonitor.swift` | 键盘事件监听 + 滚动控制 |
| `MainListView+FocusManager.swift` | 焦点状态同步 + 鼠标点击监听 |

这种分离使代码更易于维护和调试。

## 技术方案选型

### 为什么不使用 SwiftUI 的 `onKeyPress`？

1. **焦点依赖**：`onKeyPress` 需要视图获得焦点才能响应键盘事件
2. **跨视图管理困难**：在 `NavigationSplitView` 中，List 和 Detail 是独立的视图层级，难以统一管理焦点
3. **编译器限制**：复杂的 `ViewBuilder` 块容易导致 "unable to type-check this expression" 编译错误

### 采用的方案：AppKit NSEvent 监听器

使用 `NSEvent.addLocalMonitorForEvents(matching: .keyDown)` 全局监听键盘事件：

- **优点**：不依赖 SwiftUI 焦点系统，可以精确控制事件处理
- **缺点**：需要手动管理监听器生命周期，需要桥接 AppKit 和 SwiftUI

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        MainListView                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 状态管理 (MainListView.swift)                               ││
│  │ - keyboardNavigationTarget: .list / .detail                 ││
│  │ - currentDetailScrollView: NSScrollView?                    ││
│  │ - savedMasterFirstResponder: NSResponder?                   ││
│  │ - mainWindow: NSWindow?                                     ││
│  │ - keyDownMonitor: Any?                                      ││
│  │ - mouseDownMonitor: Any?                                    ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 键盘导航 (MainListView+KeyboardMonitor.swift)               ││
│  │                                                             ││
│  │ keyDownMonitor:                                             ││
│  │   ├─ keyCode 123 (←): 切换到 List                           ││
│  │   ├─ keyCode 124 (→): 切换到 Detail                         ││
│  │   ├─ keyCode 126 (↑): Detail 向上滚动 / Chats 消息导航       ││
│  │   ├─ keyCode 125 (↓): Detail 向下滚动 / Chats 消息导航       ││
│  │   ├─ keyCode 115 (Home): 滚动到顶部                         ││
│  │   ├─ keyCode 119 (End): 滚动到底部                          ││
│  │   ├─ keyCode 116 (Page Up): 向上翻页                        ││
│  │   ├─ keyCode 121 (Page Down): 向下翻页                      ││
│  │   ├─ Cmd+↑/↓: 滚动到顶部/底部                               ││
│  │   └─ Option+←/→: Chats 分类切换                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 焦点管理 (MainListView+FocusManager.swift)                  ││
│  │                                                             ││
│  │ mouseDownMonitor:                                           ││
│  │   └─ syncNavigationTargetWithFocus()                        ││
│  │                                                             ││
│  │ 焦点切换方法:                                                ││
│  │   ├─ focusDetailScrollViewIfPossible(window:)               ││
│  │   ├─ focusBackToMaster(window:)                             ││
│  │   └─ focusNotificationName(for:)                            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ListView (各数据源)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ @FocusState private var isListFocused: Bool                 ││
│  │ List(...).focused($isListFocused)                           ││
│  │                                                             ││
│  │ .onAppear { isListFocused = true }                          ││
│  │ .onReceive(DataSourceSwitchedTo* 通知) { isListFocused=true }│
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DetailView (各数据源)                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ScrollView                                                  ││
│  │   └─ EnclosingScrollViewReader                              ││
│  │        └─ onResolve: (NSScrollView) -> Void                 ││
│  │             └─ 回调给 MainListView 的 currentDetailScrollView││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 文件结构

| 文件路径 | 作用 |
|---------|------|
| `Views/Components/Main/MainListView.swift` | 主视图，定义状态变量和生命周期管理 |
| `Views/Components/Main/MainListView+KeyboardMonitor.swift` | **键盘事件监听 + 滚动控制** |
| `Views/Components/Main/MainListView+FocusManager.swift` | **焦点状态同步 + 鼠标点击监听** |
| `Views/Components/Keyboard/WindowReader.swift` | 获取 NSWindow 的 NSViewRepresentable |
| `Views/Components/Keyboard/EnclosingScrollViewReader.swift` | 获取 NSScrollView 的 NSViewRepresentable |
| `Views/Chats/ChatNotifications.swift` | Chats 相关通知名称定义 |
| `Views/AppleBooks/AppleBooksListView.swift` | Apple Books 列表视图（含 @FocusState） |
| `Views/GoodLinks/GoodLinksListView.swift` | GoodLinks 列表视图（含 @FocusState） |
| `Views/WeRead/WeReadListView.swift` | WeRead 列表视图（含 @FocusState） |
| `Views/Dedao/DedaoListView.swift` | Dedao 列表视图（含 @FocusState） |
| `Views/Chats/ChatListView.swift` | Chats 列表视图（含 @FocusState） |

## 核心组件

### 1. KeyboardNavigationTarget 枚举

```swift
// MainListView.swift

/// 键盘导航目标：当前焦点在 List 还是 Detail
enum KeyboardNavigationTarget {
    case list
    case detail
}
```

**用途**：标记当前键盘导航的焦点区域，决定方向键的行为。

### 2. MainListView 状态变量

```swift
// MainListView.swift

// MARK: - Keyboard Navigation State (internal for extensions)

/// 当前键盘导航目标（List 或 Detail）
@State var keyboardNavigationTarget: KeyboardNavigationTarget = .list
/// 当前 Detail 视图的 NSScrollView（用于键盘滚动）
@State var currentDetailScrollView: NSScrollView?
/// 保存进入 Detail 前的 firstResponder，用于返回时恢复
@State var savedMasterFirstResponder: NSResponder?
/// 当前窗口引用（用于过滤键盘事件）
@State var mainWindow: NSWindow?
/// 键盘事件监听器
@State var keyDownMonitor: Any?
/// 鼠标点击事件监听器（用于同步焦点状态）
@State var mouseDownMonitor: Any?
```

### 3. WindowReader

```swift
// Views/Components/Keyboard/WindowReader.swift

/// 读取 SwiftUI 视图所在的 `NSWindow`。
///
/// - Note: 通过 `NSViewRepresentable` 把 window 注入到 SwiftUI state，适用于需要基于窗口过滤 NSEvent 的场景。
struct WindowReader: NSViewRepresentable {
    @Binding var window: NSWindow?
    
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            self.window = view.window
        }
        return view
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if self.window !== nsView.window {
                self.window = nsView.window
            }
        }
    }
}
```

**用途**：获取当前视图所在的 `NSWindow`，用于过滤键盘事件，确保只处理主窗口的事件。

**使用方式**：
```swift
// MainListView.swift body
mainContent
    .background(WindowReader(window: $mainWindow))
```

### 4. EnclosingScrollViewReader

```swift
// Views/Components/Keyboard/EnclosingScrollViewReader.swift

/// 在 `ScrollView` 内容内部使用，用于拿到其底层 `NSScrollView`（enclosingScrollView）。
///
/// 典型用法：放在 `ScrollView` 的内容里（例如顶部 `Color.clear` 的 background），即可回调当前的 `NSScrollView`。
struct EnclosingScrollViewReader: NSViewRepresentable {
    var onResolve: (NSScrollView) -> Void
    
    final class Coordinator {
        weak var lastScrollView: NSScrollView?
    }
    
    func makeCoordinator() -> Coordinator { Coordinator() }
    
    func makeNSView(context: Context) -> NSView {
        NSView()
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        // 需要等视图挂到层级后 enclosingScrollView 才稳定
        DispatchQueue.main.async {
            guard let scrollView = nsView.enclosingScrollView else { return }
            if context.coordinator.lastScrollView !== scrollView {
                context.coordinator.lastScrollView = scrollView
                onResolve(scrollView)
            }
        }
    }
}
```

**用途**：获取 SwiftUI `ScrollView` 底层的 `NSScrollView`，用于程序化滚动。

### 5. 键盘事件监听器

```swift
// MainListView+KeyboardMonitor.swift

func startKeyboardMonitorIfNeeded() {
    guard keyDownMonitor == nil else { return }
    
    keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
        // 只处理 MainListView 所在窗口的事件，避免影响 Settings 等其它窗口
        guard let window = self.mainWindow, event.window === window else {
            return event
        }
        
        // 检查修饰键
        let modifiers = event.modifierFlags
        let hasCommand = modifiers.contains(.command)
        let hasOption = modifiers.contains(.option)
        let hasControl = modifiers.contains(.control)
        
        // Cmd+↑/↓ 用于 Detail 滚动到顶部/底部
        if hasCommand && !hasOption && !hasControl {
            switch event.keyCode {
            case 126: // Cmd+↑ 滚动到顶部
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToTop()
                    return nil  // 消费事件
                }
            case 125: // Cmd+↓ 滚动到底部
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToBottom()
                    return nil
                }
            default:
                // 其他 Cmd 组合键（如 Cmd+←/→ 切换数据源）不拦截
                return event
            }
        }
        
        // Option+←/→ 用于 Chats 分类切换
        if hasOption && !hasCommand && !hasControl {
            if self.contentSource == .chats && self.keyboardNavigationTarget == .detail {
                switch event.keyCode {
                case 123: // Option+← 切换分类（向左：我 → 系统 → 对方）
                    NotificationCenter.default.post(
                        name: .chatsCycleClassification,
                        object: nil,
                        userInfo: ["direction": "left"]
                    )
                    return nil
                case 124: // Option+→ 切换分类（向右：对方 → 系统 → 我）
                    NotificationCenter.default.post(
                        name: .chatsCycleClassification,
                        object: nil,
                        userInfo: ["direction": "right"]
                    )
                    return nil
                default:
                    break
                }
            }
            return event
        }
        
        // 不拦截带 Control 的组合键
        if hasControl {
            return event
        }
        
        // 普通方向键处理
        switch event.keyCode {
        case 123: // ←
            if self.keyboardNavigationTarget == .detail {
                self.keyboardNavigationTarget = .list
                self.focusBackToMaster(window: window)
                return nil
            }
        case 124: // →
            if self.keyboardNavigationTarget == .list, self.hasSingleSelectionForCurrentSource() {
                self.savedMasterFirstResponder = window.firstResponder
                self.keyboardNavigationTarget = .detail
                self.focusDetailScrollViewIfPossible(window: window)
                return nil
            }
        case 126: // ↑
            if self.keyboardNavigationTarget == .detail {
                if self.contentSource == .chats {
                    NotificationCenter.default.post(
                        name: .chatsNavigateMessage,
                        object: nil,
                        userInfo: ["direction": "up"]
                    )
                    return nil
                }
                self.scrollCurrentDetail(byLines: -1)
                return nil
            }
        case 125: // ↓
            if self.keyboardNavigationTarget == .detail {
                if self.contentSource == .chats {
                    NotificationCenter.default.post(
                        name: .chatsNavigateMessage,
                        object: nil,
                        userInfo: ["direction": "down"]
                    )
                    return nil
                }
                self.scrollCurrentDetail(byLines: 1)
                return nil
            }
        // ... Home, End, Page Up, Page Down
        default:
            return event
        }
        
        return event
    }
    
    // 监听鼠标点击，同步焦点状态
    startMouseDownMonitorIfNeeded()
}
```

### 6. 焦点管理模块 (MainListView+FocusManager.swift)

从 v0.9.11 开始，焦点管理相关代码已分离到独立文件 `MainListView+FocusManager.swift`。

#### 鼠标点击焦点同步（v0.9.12+ 改进版）

```swift
// MainListView+FocusManager.swift

func startMouseDownMonitorIfNeeded() {
    guard mouseDownMonitor == nil else { return }
    
    mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
        // 只处理 MainListView 所在窗口的事件
        guard let window = self.mainWindow, event.window === window else {
            return event
        }
        
        // 记录点击位置
        let clickLocationInWindow = event.locationInWindow
        
        // 延迟检查焦点，因为点击后焦点可能还没有切换
        // v0.9.12: 延迟从 0.1s 增加到 0.15s，给 SwiftUI 手势更多处理时间
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            // 先按当前 firstResponder 同步状态
            self.syncNavigationTargetWithFocus()
            
            // 兜底：如果用户点击了 Detail 区域，但 firstResponder 仍停留在 List，
            // 则强制让 Detail 的 NSScrollView 成为 firstResponder
            guard self.keyboardNavigationTarget == .list else { return }
            
            // v0.9.12: 检查点击是否在 Detail ScrollView 内，并获取命中的视图
            guard let (isInside, hitView) = self.checkPointInDetailScrollView(clickLocationInWindow, window: window),
                  isInside else { return }
            
            // v0.9.12: 如果点击的是交互控件，不强制切换焦点
            // 允许 SwiftUI 的手势处理器和控件自然处理焦点
            if self.isInteractiveElement(hitView) {
                return
            }
            
            // 点击的是被动区域（如背景、padding、空白ScrollView等），强制切换焦点
            self.savedMasterFirstResponder = window.firstResponder
            self.keyboardNavigationTarget = .detail
            self.focusDetailScrollViewIfPossible(window: window)
        }
        
        return event
    }
}

/// 根据当前 firstResponder 同步 keyboardNavigationTarget 状态
func syncNavigationTargetWithFocus() {
    guard let window = mainWindow else { return }
    guard let firstResponder = window.firstResponder else { return }
    
    // 检查 firstResponder 是否在 Detail 的 ScrollView 中
    if let detailScrollView = currentDetailScrollView {
        var responder: NSResponder? = firstResponder
        while let r = responder {
            if r === detailScrollView || r === detailScrollView.contentView {
                keyboardNavigationTarget = .detail
                return
            }
            responder = r.nextResponder
        }
    }
    
    // 否则认为焦点在 List
    keyboardNavigationTarget = .list
}

/// v0.9.12: 检查点击是否在 Detail ScrollView 内，并返回命中的视图
private func checkPointInDetailScrollView(_ locationInWindow: NSPoint, window: NSWindow) -> (Bool, NSView?) {
    guard let scrollView = currentDetailScrollView else { return (false, nil) }
    guard scrollView.window === window else { return (false, nil) }
    guard let contentView = window.contentView else { return (false, nil) }
    
    let pointInContentView = contentView.convert(locationInWindow, from: nil)
    guard let hitView = contentView.hitTest(pointInContentView) else { return (false, nil) }
    
    var view: NSView? = hitView
    while let v = view {
        if v === scrollView || v === scrollView.contentView || v === scrollView.documentView {
            return (true, hitView)
        }
        view = v.superview
    }
    
    return (false, nil)
}

/// v0.9.12: 判断视图是否为交互元素（按钮、文本框、可点击控件等）
private func isInteractiveElement(_ view: NSView?) -> Bool {
    guard let view = view else { return false }
    
    // 检查 AppKit 交互控件
    if view is NSButton || view is NSTextField || view is NSTextView {
        return true
    }
    
    // 检查 SwiftUI 内部类名
    let className = String(describing: type(of: view))
    if className.contains("Button") || 
       className.contains("Control") || 
       className.contains("Gesture") ||
       className.contains("Interaction") {
        return true
    }
    
    // 检查父视图链（最多 5 层）
    var parent = view.superview
    var depth = 0
    while let p = parent, depth < 5 {
        let parentClassName = String(describing: type(of: p))
        if parentClassName.contains("Button") || 
           parentClassName.contains("Control") ||
           parentClassName.contains("TextField") {
            return true
        }
        parent = p.superview
        depth += 1
    }
    
    return false
}
```

**改进说明（v0.9.12）**：
- **延迟时间**：从 0.1s 增加到 0.15s，给 SwiftUI 手势识别更多时间
- **交互元素检测**：新增 `isInteractiveElement()` 方法，识别按钮、控件、手势响应视图
- **智能焦点切换**：只在点击被动区域（背景、空白）时强制切换焦点
- **保护交互**：点击消息气泡、按钮等交互元素时不强制切换焦点，避免干扰用户操作

#### 焦点切换方法

```swift
// MainListView+FocusManager.swift

func focusDetailScrollViewIfPossible(window: NSWindow) {
    guard let scrollView = currentDetailScrollView else { return }
    DispatchQueue.main.async {
        // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
        _ = window.makeFirstResponder(scrollView.contentView)
    }
}

func focusBackToMaster(window: NSWindow) {
    let responder = savedMasterFirstResponder
    DispatchQueue.main.async {
        if let responder, window.makeFirstResponder(responder) {
            return
        }
        // 兜底：触发当前数据源 List 再次请求焦点
        NotificationCenter.default.post(
            name: self.focusNotificationName(for: self.contentSource),
            object: nil
        )
    }
}

func focusNotificationName(for source: ContentSource) -> Notification.Name {
    switch source {
    case .appleBooks:
        return Notification.Name("DataSourceSwitchedToAppleBooks")
    case .goodLinks:
        return Notification.Name("DataSourceSwitchedToGoodLinks")
    case .weRead:
        return Notification.Name("DataSourceSwitchedToWeRead")
    case .dedao:
        return Notification.Name("DataSourceSwitchedToDedao")
    case .chats:
        return Notification.Name("DataSourceSwitchedToChats")
    }
}
```

### 7. 模块职责划分

| 文件 | 包含的方法 | 职责 |
|------|-----------|------|
| `MainListView+KeyboardMonitor.swift` | `startKeyboardMonitorIfNeeded()`, `stopKeyboardMonitorIfNeeded()`, `hasSingleSelectionForCurrentSource()`, `scrollCurrentDetail(byLines:)`, `scrollCurrentDetailToTop/Bottom()`, `scrollCurrentDetailByPage(up:)` | 键盘事件监听 + 滚动控制 |
| `MainListView+FocusManager.swift` | `startMouseDownMonitorIfNeeded()`, `stopMouseDownMonitorIfNeeded()`, `syncNavigationTargetWithFocus()`, `focusDetailScrollViewIfPossible(window:)`, `focusBackToMaster(window:)`, `focusNotificationName(for:)` | 焦点状态同步 + 鼠标点击监听 |

### 8. 滚动控制

```swift
// MainListView+KeyboardMonitor.swift

func scrollCurrentDetail(byLines lines: Int) {
    guard let scrollView = currentDetailScrollView else { return }
    guard let documentView = scrollView.documentView else { return }
    
    // 基于 "一行" 的滚动步长（同时考虑动态字体缩放）
    let baseStep: CGFloat = 56
    let step = baseStep * fontScaleManager.scaleFactor
    let delta = CGFloat(lines) * step
    
    // flipped 坐标系下，y 增大表示向下
    let effectiveDelta = (documentView.isFlipped ? delta : -delta)
    
    let clipView = scrollView.contentView
    var newOrigin = clipView.bounds.origin
    newOrigin.y += effectiveDelta
    
    let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
    newOrigin.y = min(max(newOrigin.y, 0), maxY)
    
    clipView.scroll(to: newOrigin)
    scrollView.reflectScrolledClipView(clipView)
}

/// 滚动到顶部 (Home / Cmd+↑)
func scrollCurrentDetailToTop() { ... }

/// 滚动到底部 (End / Cmd+↓)
func scrollCurrentDetailToBottom() { ... }

/// 按页滚动 (Page Up / Page Down)
func scrollCurrentDetailByPage(up: Bool) { ... }
```

### 9. ListView 的 @FocusState

每个 ListView 都使用 `@FocusState` 来管理焦点：

```swift
// 以 AppleBooksListView.swift 为例

struct AppleBooksListView: View {
    @ObservedObject var viewModel: AppleBooksViewModel
    @Binding var selectionIds: Set<String>
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool

    var body: some View {
        Group {
            // ... loading / error / empty states
            List(selection: $selectionIds) {
                // ... content
            }
            .listStyle(.sidebar)
            .focused($isListFocused)
        }
        .onAppear {
            // ... load data
            // 延迟获取焦点，确保视图已完全加载
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToAppleBooks")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
    }
}
```

**所有使用 @FocusState 的 ListView**：
- `AppleBooksListView.swift`
- `GoodLinksListView.swift`
- `WeReadListView.swift`
- `DedaoListView.swift`
- `ChatListView.swift`

### 10. Chats 特有的通知

```swift
// Views/Chats/ChatNotifications.swift

extension Notification.Name {
    static let chatsNavigateMessage = Notification.Name("ChatNavigateMessage")
    static let chatsCycleClassification = Notification.Name("ChatCycleClassification")
}
```

这些通知由 `MainListView+KeyboardMonitor.swift` 发送，由 `ChatDetailView.swift` 接收处理。

## 快捷键映射

| 按键 | keyCode | 功能 | 条件 |
| --- | --- | --- | --- |
| ← | 123 | 返回 List | `keyboardNavigationTarget == .detail` |
| → | 124 | 进入 Detail | `keyboardNavigationTarget == .list` 且选中单个项目 |
| ↑ | 126 | 向上滚动一行 / Chats 消息导航 | `keyboardNavigationTarget == .detail` |
| ↓ | 125 | 向下滚动一行 / Chats 消息导航 | `keyboardNavigationTarget == .detail` |
| Cmd+↑ | 126 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| Cmd+↓ | 125 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Option+← | 123 | Chats 分类切换（向左） | `contentSource == .chats` && `keyboardNavigationTarget == .detail` |
| Option+→ | 124 | Chats 分类切换（向右） | `contentSource == .chats` && `keyboardNavigationTarget == .detail` |
| Home (Fn+←) | 115 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| End (Fn+→) | 119 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Page Up (Fn+↑) | 116 | 向上翻页 | `keyboardNavigationTarget == .detail` |
| Page Down (Fn+↓) | 121 | 向下翻页 | `keyboardNavigationTarget == .detail` |

### 不拦截的系统快捷键

| 按键 | 说明 |
| --- | --- |
| Cmd+←/→ | 数据源切换（由 ViewCommands 处理） |
| Control+任意键 | 传递给系统 |
| 其他 Cmd 组合键 | 传递给系统 |

## DetailView 集成

每个 DetailView 需要添加 `onScrollViewResolved` 参数：

```swift
struct AppleBooksDetailView: View {
    @ObservedObject var viewModelList: AppleBooksViewModel
    @Binding var selectedBookId: String?
    var onScrollViewResolved: (NSScrollView) -> Void

    var body: some View {
        ScrollView {
            VStack {
                Color.clear
                    .frame(height: 0)
                    .id("detailTop")
                    .background(
                        EnclosingScrollViewReader { scrollView in
                            onScrollViewResolved(scrollView)
                        }
                    )
                // ... 其他内容
            }
        }
    }
}
```

**重要**：即使是空状态或加载状态，也应该保留一个可解析的 ScrollView，以确保键盘焦点切换正常工作（见 `ChatDetailView.swift` 的实现）。

## 生命周期管理

```swift
// MainListView.swift body

.onAppear {
    // 根据当前启用的数据源初始化滑动容器
    updateDataSourceSwitchViewModel()
    // 同步滑动容器与菜单状态
    syncSwipeViewModelWithContentSource()
    // 启动键盘监听（键盘导航模块）
    startKeyboardMonitorIfNeeded()
    // 启动鼠标监听（焦点管理模块）
    startMouseDownMonitorIfNeeded()
}
.onDisappear {
    stopKeyboardMonitorIfNeeded()
    stopMouseDownMonitorIfNeeded()
}
```

```swift
// MainListView+KeyboardMonitor.swift

func stopKeyboardMonitorIfNeeded() {
    if let monitor = keyDownMonitor {
        NSEvent.removeMonitor(monitor)
        keyDownMonitor = nil
    }
}
```

```swift
// MainListView+FocusManager.swift

func stopMouseDownMonitorIfNeeded() {
    if let monitor = mouseDownMonitor {
        NSEvent.removeMonitor(monitor)
        mouseDownMonitor = nil
    }
}
```

## 数据源切换时的状态重置

```swift
// MainListView.swift

.onChange(of: contentSourceRawValue) { _, _ in
    // 切换数据源时重置选择和焦点状态
    selectedBookIds.removeAll()
    selectedLinkIds.removeAll()
    selectedWeReadBookIds.removeAll()
    selectedDedaoBookIds.removeAll()
    keyboardNavigationTarget = .list
    currentDetailScrollView = nil
}
```

## 已知问题

### ~~鼠标点击 DetailView 时 List 高亮不变化~~ ✅ 已在 v0.9.12 修复

**问题描述**：~~当用户用鼠标点击 DetailView 时，ListView 的选中项高亮颜色不会从强调色（蓝色）变为灰色。而使用键盘左右方向键导航时，高亮颜色正确变化。~~

**根本原因**：
1. ~~键盘导航正确工作是因为我们主动调用了 `window.makeFirstResponder(scrollView.contentView)`~~
2. ~~鼠标点击时，`syncNavigationTargetWithFocus()` 只更新了 `keyboardNavigationTarget` 状态，没有调用 `makeFirstResponder`~~
3. ~~AppKit 的 `firstResponder` 决定了 List 的高亮颜色，但 SwiftUI 的 ScrollView 点击时可能不会自动成为 firstResponder~~

**修复方案（v0.9.12 已实施）**：
- 在 `mouseDownMonitor` 中增加了"兜底"逻辑：检测到点击 Detail 但焦点仍在 List 时，主动调用 `makeFirstResponder`
- 延长延迟时间从 0.1s 到 0.15s，给 SwiftUI 手势识别更多时间
- 增加交互元素检测（`isInteractiveElement()`），避免点击按钮、消息气泡等交互元素时误触焦点切换
- 只在点击"被动区域"（背景、空白、padding）时才强制切换焦点

**修复效果**：
- ✅ 点击 Detail 空白区域 → List 高亮变灰（焦点切换到 Detail）
- ✅ 点击 List → List 高亮恢复蓝色（焦点返回 List）
- ✅ 点击消息气泡、按钮等交互元素 → 不强制切换焦点，元素自然处理
- ✅ 键盘 ←/→ 导航 → 继续正常工作

**详见**：`.cursor/plans/ListView-DetailView-Focus-State-Fix-Plans.md` 中的 P1 方案及 v0.9.12 改进。

## 扩展指南

### 添加新的快捷键

1. 在 `startKeyboardMonitorIfNeeded()` 的 switch 语句中添加新的 case
2. 确保正确检查 `keyboardNavigationTarget` 状态和修饰键
3. 返回 `nil` 消费事件，或返回 `event` 传递给系统

### 添加新的 DetailView

1. 在新的 DetailView 中添加 `onScrollViewResolved: (NSScrollView) -> Void` 参数
2. 在 ScrollView 内部使用 `EnclosingScrollViewReader` 获取 NSScrollView
3. 在 MainListView 的 `detailColumn`（`MainListView+DetailViews.swift`）中传递回调
4. 确保空状态和加载状态也有可解析的 ScrollView

### 添加新的数据源 ListView

1. 添加 `@FocusState private var isListFocused: Bool`
2. 在 List 上添加 `.focused($isListFocused)`
3. 在 `.onAppear` 中设置 `isListFocused = true`
4. 监听对应的 `DataSourceSwitchedTo*` 通知并设置焦点
5. 在 `MainListView+FocusManager.swift` 的 `focusNotificationName(for:)` 中添加映射

## 注意事项

1. **生命周期管理**：确保在 `onDisappear` 中调用 `stopKeyboardMonitorIfNeeded()` 移除监听器
2. **窗口过滤**：始终检查 `event.window === window` 避免影响其他窗口（如 Settings）
3. **修饰键检查**：Cmd+←/→ 已用于切换数据源，不要拦截
4. **焦点同步**：用户点击时需要通过 `syncNavigationTargetWithFocus()` 同步状态
5. **动态字体缩放**：滚动步长需要考虑 `fontScaleManager.scaleFactor`
6. **延迟检查**：`mouseDownMonitor` 使用 0.1 秒延迟，等待 AppKit 完成焦点切换后再检查
7. **空状态处理**：DetailView 的空状态也需要提供 ScrollView，否则键盘切换会失效

