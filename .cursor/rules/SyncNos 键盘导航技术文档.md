# SyncNos 键盘导航技术文档

version: v0.9.9
上次编辑时间: 2025年12月19日 22:40
创建时间: 2025年12月15日 14:47
标签: docs, feat
状态: 完成

# 概述

SyncNos 实现了完整的键盘导航功能，允许用户在 List 和 Detail 视图之间切换，并在 Detail 视图中进行滚动操作。

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
│  │ 状态管理                                                     ││
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
│  │ NSEvent 监听器                                               ││
│  │                                                             ││
│  │ keyDownMonitor:                                             ││
│  │   ├─ keyCode 123 (←): 切换到 List                           ││
│  │   ├─ keyCode 124 (→): 切换到 Detail                         ││
│  │   ├─ keyCode 126 (↑): Detail 向上滚动                       ││
│  │   ├─ keyCode 125 (↓): Detail 向下滚动                       ││
│  │   ├─ keyCode 115 (Home): 滚动到顶部                         ││
│  │   ├─ keyCode 119 (End): 滚动到底部                          ││
│  │   ├─ keyCode 116 (Page Up): 向上翻页                        ││
│  │   └─ keyCode 121 (Page Down): 向下翻页                      ││
│  │                                                             ││
│  │ mouseDownMonitor:                                           ││
│  │   └─ 同步焦点状态                                            ││
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

## 核心组件

### 1. WindowReader

```swift
// SyncNos/Views/Components/Keyboard/WindowReader.swift

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

### 2. EnclosingScrollViewReader

```swift
// SyncNos/Views/Components/Keyboard/EnclosingScrollViewReader.swift

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

### 3. 键盘事件监听

```swift
// MainListView.swift

private func startKeyboardMonitorIfNeeded() {
    guard keyDownMonitor == nil else { return }

    keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
        // 只处理 MainListView 所在窗口的事件
        guard let window = self.mainWindow, event.window === window else {
            return event
        }

        // 检查修饰键
        let modifiers = event.modifierFlags
        let hasCommand = modifiers.contains(.command)

        // Cmd+↑/↓ 用于滚动到顶部/底部
        if hasCommand {
            switch event.keyCode {
            case 126: // Cmd+↑
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToTop()
                    return nil  // 消费事件
                }
            case 125: // Cmd+↓
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToBottom()
                    return nil
                }
            default:
                return event  // 不消费，传递给系统
            }
        }

        // 普通方向键处理...
        switch event.keyCode {
        case 123: // ←
            if self.keyboardNavigationTarget == .detail {
                self.keyboardNavigationTarget = .list
                self.focusBackToMaster(window: window)
                return nil
            }
        // ... 其他按键
        }

        return event
    }
}

```

### 4. 焦点管理

```swift
// MainListView.swift

private func focusDetailScrollViewIfPossible(window: NSWindow) {
    guard let scrollView = currentDetailScrollView else { return }
    DispatchQueue.main.async {
        _ = window.makeFirstResponder(scrollView.contentView)
    }
}

private func focusBackToMaster(window: NSWindow) {
    let responder = savedMasterFirstResponder
    DispatchQueue.main.async {
        if let responder, window.makeFirstResponder(responder) {
            return
        }
        // 兜底：发送通知让 List 重新获取焦点
        NotificationCenter.default.post(
            name: self.focusNotificationName(for: self.contentSource),
            object: nil
        )
    }
}

```

### 5. 滚动控制

```swift
// MainListView.swift

private func scrollCurrentDetail(byLines lines: Int) {
    guard let scrollView = currentDetailScrollView else { return }
    guard let documentView = scrollView.documentView else { return }

    let baseStep: CGFloat = 56
    let step = baseStep * fontScaleManager.scaleFactor
    let delta = CGFloat(lines) * step

    let effectiveDelta = (documentView.isFlipped ? delta : -delta)

    let clipView = scrollView.contentView
    var newOrigin = clipView.bounds.origin
    newOrigin.y += effectiveDelta

    let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
    newOrigin.y = min(max(newOrigin.y, 0), maxY)

    clipView.scroll(to: newOrigin)
    scrollView.reflectScrolledClipView(clipView)
}

```

## 快捷键映射

| 按键 | keyCode | 功能 | 条件 |
| --- | --- | --- | --- |
| ← | 123 | 返回 List | `keyboardNavigationTarget == .detail` |
| → | 124 | 进入 Detail | `keyboardNavigationTarget == .list` 且选中单个项目 |
| ↑ | 126 | 向上滚动一行 | `keyboardNavigationTarget == .detail` |
| ↓ | 125 | 向下滚动一行 | `keyboardNavigationTarget == .detail` |
| Cmd+↑ | 126 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| Cmd+↓ | 125 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Home | 115 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| End | 119 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Page Up | 116 | 向上翻页 | `keyboardNavigationTarget == .detail` |
| Page Down | 121 | 向下翻页 | `keyboardNavigationTarget == .detail` |

## DetailView 集成

每个 DetailView 需要添加 `onScrollViewResolved` 参数：

```swift
struct AppleBooksDetailView: View {
    @ObservedObject var viewModelList: AppleBooksViewModel
    @Binding var selectedBookId: String?
    var onScrollViewResolved: (NSScrollView) -> Void  // 新增

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

## 扩展指南

### 添加新的快捷键

1. 在 `startKeyboardMonitorIfNeeded()` 的 switch 语句中添加新的 case
2. 确保正确检查 `keyboardNavigationTarget` 状态
3. 返回 `nil` 消费事件，或返回 `event` 传递给系统

### 添加新的 DetailView

1. 在新的 DetailView 中添加 `onScrollViewResolved: (NSScrollView) -> Void` 参数
2. 在 ScrollView 内部使用 `EnclosingScrollViewReader` 获取 NSScrollView
3. 在 MainListView 的 `detailColumn` 中传递回调

## 注意事项

1. **生命周期管理**：确保在 `onDisappear` 中调用 `stopKeyboardMonitorIfNeeded()` 移除监听器
2. **窗口过滤**：始终检查 `event.window === window` 避免影响其他窗口（如 Settings）
3. **修饰键检查**：Cmd+←/→ 已用于切换数据源，不要拦截
4. **焦点同步**：用户点击时需要同步 `keyboardNavigationTarget` 状态
5. **动态字体缩放**：滚动步长需要考虑 `fontScaleManager.scaleFactor`