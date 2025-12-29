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
│  │ - detailFirstResponderProxyView: NSView?                    ││
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
│  │ 入口：MainListView.swift 的 master/detail TapGesture          ││
│  │   ├─ master: keyboardNavigationTarget = .list               ││
│  │   └─ detail: keyboardNavigationTarget = .detail + focusDetail││
│  │                                                             ││
│  │ 焦点切换方法:                                                ││
│  │   ├─ focusDetailIfPossible(window:)                         ││
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
| `Views/Components/Main/MainListView+FocusManager.swift` | **焦点切换方法（List/Detail）** |
| `Views/Components/Keyboard/WindowReader.swift` | 获取 NSWindow 的 NSViewRepresentable |
| `Views/Components/Keyboard/EnclosingScrollViewReader.swift` | 获取 NSScrollView 的 NSViewRepresentable |
| `Views/Components/Keyboard/FirstResponderProxyView.swift` | Detail 侧稳定 firstResponder “落点”（透明 NSView） |
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
/// Detail 侧稳定的 firstResponder 落点（透明 NSView）
@State var detailFirstResponderProxyView: NSView?
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
                self.focusDetailIfPossible(window: window)
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
    
}
```

### 6. 焦点管理模块 (MainListView+FocusManager.swift)

从 v0.9.12（P4）开始，鼠标焦点切换不再依赖 `mouseDownMonitor`，改为在 SwiftUI 层（`MainListView.swift`）显式处理：

- **masterColumn 点击**：`keyboardNavigationTarget = .list`
- **detailColumn 点击**：在单选时 `keyboardNavigationTarget = .detail`，并调用 `focusDetailIfPossible(window:)` 抢走 firstResponder

同时，为了彻底规避「ScrollView/覆盖层点击不产生 firstResponder」的问题，引入 `FirstResponderProxyView` 作为 Detail 侧稳定 firstResponder 落点。

```swift
// MainListView.swift（简化示意）
NavigationSplitView {
    masterColumn
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded {
            keyboardNavigationTarget = .list
        })
} detail: {
    detailColumn
        .background(FirstResponderProxyView(view: $detailFirstResponderProxyView))
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded {
            guard hasSingleSelectionForCurrentSource(), let window = mainWindow else { return }
            if window.firstResponder is NSTextView { return }   // 避免抢走文本编辑
            if keyboardNavigationTarget == .list { savedMasterFirstResponder = window.firstResponder }
            keyboardNavigationTarget = .detail
            focusDetailIfPossible(window: window)
        })
}
```

焦点切换方法仍集中在 `MainListView+FocusManager.swift`：

```swift
// MainListView+FocusManager.swift（简化示意）
func focusDetailIfPossible(window: NSWindow) {
    DispatchQueue.main.async {
        guard let proxy = detailFirstResponderProxyView else { return }
        _ = window.makeFirstResponder(proxy)
    }
}
```

### 7. 模块职责划分

| 文件 | 包含的方法 | 职责 |
|------|-----------|------|
| `MainListView+KeyboardMonitor.swift` | `startKeyboardMonitorIfNeeded()`, `stopKeyboardMonitorIfNeeded()`, `hasSingleSelectionForCurrentSource()`, `scrollCurrentDetail(byLines:)`, `scrollCurrentDetailToTop/Bottom()`, `scrollCurrentDetailByPage(up:)` | 键盘事件监听 + 滚动控制 |
| `MainListView+FocusManager.swift` | `focusDetailIfPossible(window:)`, `focusBackToMaster(window:)`, `focusNotificationName(for:)` | 焦点切换方法（List/Detail） |

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
            // 获取焦点（避免额外延迟引入的竞态）
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToAppleBooks")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
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
}
.onDisappear {
    stopKeyboardMonitorIfNeeded()
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

> P4 方案后不再使用 `mouseDownMonitor`，因此也不需要 stopMouseDownMonitorIfNeeded。

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

### 鼠标点击 DetailView 时 List 高亮不变化（✅ 已解决）

该问题已通过 **P4（SwiftUI 手势 + FirstResponderProxyView）** 修复：
- 鼠标点击 detailColumn 会在单选时主动切换 `keyboardNavigationTarget = .detail` 并将 firstResponder 设置为 `FirstResponderProxyView` 的透明 NSView；
- 从而使 List 选中高亮进入非激活态（灰色）。

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
4. **鼠标焦点入口唯一**：鼠标点击的焦点切换由 `MainListView.swift` 的 master/detail `TapGesture` 统一处理，避免多处分散判断导致竞态/误判
5. **动态字体缩放**：滚动步长需要考虑 `fontScaleManager.scaleFactor`
6. **Detail firstResponder 落点**：detailColumn 必须保留 `FirstResponderProxyView` 作为稳定的 firstResponder 目标
7. **空状态处理**：DetailView 的空状态也需要提供 ScrollView，否则键盘切换会失效

