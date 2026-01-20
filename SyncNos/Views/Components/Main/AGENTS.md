# 键盘导航技术文档

## 概述

SyncNos 实现了完整的键盘导航功能，允许用户在 List 和 Detail 视图之间切换，并在 Detail 视图中进行滚动操作。

> **兼容性说明**: 本键盘导航系统已完全兼容协议驱动重构（Protocol-Driven Refactoring），支持统一的选择状态管理（`SelectionState`）和数据源 UI 配置协议（`DataSourceUIProvider`）。

---

## 模块分离

键盘导航和焦点管理的代码已分离为两个独立的扩展文件：

| 文件 | 职责 |
|------|------|
| `MainListView+KeyboardMonitor.swift` | 键盘事件监听 + 滚动控制 |
| `MainListView+FocusManager.swift` | 焦点状态同步 + 鼠标点击监听 |

---

## 技术方案

### 为什么不使用 SwiftUI 的 `onKeyPress`？

1. **焦点依赖**：`onKeyPress` 需要视图获得焦点才能响应键盘事件
2. **跨视图管理困难**：在 `NavigationSplitView` 中，List 和 Detail 是独立的视图层级
3. **编译器限制**：复杂的 `ViewBuilder` 块容易导致编译错误

### 采用的方案：AppKit NSEvent 监听器

使用 `NSEvent.addLocalMonitorForEvents(matching: .keyDown)` 全局监听键盘事件：

- **优点**：不依赖 SwiftUI 焦点系统，可以精确控制事件处理
- **缺点**：需要手动管理监听器生命周期，需要桥接 AppKit 和 SwiftUI

---

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
└─────────────────────────────────────────────────────────────────┘
```

---

## 快捷键映射

| 按键 | keyCode | 功能 | 条件 |
|------|---------|------|------|
| ← | 123 | 返回 List | `keyboardNavigationTarget == .detail` |
| → | 124 | 进入 Detail | `keyboardNavigationTarget == .list` 且选中单个项目 |
| ↑ | 126 | 向上滚动一行 / Chats 消息导航 | `keyboardNavigationTarget == .detail` |
| ↓ | 125 | 向下滚动一行 / Chats 消息导航 | `keyboardNavigationTarget == .detail` |
| Cmd+↑ | 126 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| Cmd+↓ | 125 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Option+← | 123 | Chats 分类切换（向左） | `contentSource == .chats` && `detail` |
| Option+→ | 124 | Chats 分类切换（向右） | `contentSource == .chats` && `detail` |
| Home (Fn+←) | 115 | 滚动到顶部 | `keyboardNavigationTarget == .detail` |
| End (Fn+→) | 119 | 滚动到底部 | `keyboardNavigationTarget == .detail` |
| Page Up (Fn+↑) | 116 | 向上翻页 | `keyboardNavigationTarget == .detail` |
| Page Down (Fn+↓) | 121 | 向下翻页 | `keyboardNavigationTarget == .detail` |

### 不拦截的系统快捷键

| 按键 | 说明 |
|------|------|
| ⌥⌘←/→ | 数据源切换（由 ViewCommands 处理） |
| Control+任意键 | 传递给系统 |
| 其他 Cmd 组合键 | 传递给系统 |

---

## 核心组件

### WindowReader

获取当前视图所在的 `NSWindow`，用于过滤键盘事件：

```swift
// MainListView.swift body
mainContent
    .background(WindowReader(window: $mainWindow))
```

### EnclosingScrollViewReader

获取 SwiftUI `ScrollView` 底层的 `NSScrollView`，用于程序化滚动：

```swift
ScrollView {
    VStack {
        Color.clear
            .frame(height: 0)
            .background(
                EnclosingScrollViewReader { scrollView in
                    onScrollViewResolved(scrollView)
                }
            )
        // ... 内容
    }
}
```

### FirstResponderProxyView

Detail 侧稳定的 firstResponder 落点（透明 NSView），解决 ScrollView 点击不产生 firstResponder 的问题。

---

## ListView 焦点管理（必需）

**所有 ListView 都必须实现焦点管理**：

```swift
struct XxxListView: View {
    @FocusState private var isListFocused: Bool
    
    var body: some View {
        List(selection: $selectionIds) {
            // ...
        }
        .listStyle(.sidebar)
        .focused($isListFocused)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isListFocused = true
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: ContentSource.xxx.listFocusRequestedNotification)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
    }
}
```

---

## DetailView 键盘滚动支持（必需）

**所有 DetailView 都必须支持键盘滚动**：

```swift
struct XxxDetailView: View {
    var onScrollViewResolved: (NSScrollView) -> Void
    
    var body: some View {
        ScrollView {
            VStack {
                Color.clear
                    .frame(height: 0)
                    .id("xxxDetailTop")
                    .background(
                        EnclosingScrollViewReader { scrollView in
                            onScrollViewResolved(scrollView)
                        }
                    )
                // ... 内容
            }
        }
    }
}
```

---

## DetailView 特殊快捷键

如果 DetailView 需要响应特殊的键盘快捷键（如 Chats 的 Option+方向键），**不要使用 SwiftUI 的 `@FocusState` + `.onKeyPress()`**。

**正确做法**：在 MainListView 的键盘监听器中添加处理，通过通知让 DetailView 执行操作：

```swift
// MainListView+KeyboardMonitor.swift
if hasOption && !hasCommand && !hasControl {
    if self.contentSource == .xxx && self.keyboardNavigationTarget == .detail {
        switch event.keyCode {
        case 126: // Option+↑
            NotificationCenter.default.post(
                name: .xxxNavigateUp,  // 需先在 NotificationNames.swift 中定义
                object: nil
            )
            return nil
        // ...
        }
    }
}
```

---

## 生命周期管理

```swift
// MainListView.swift
.onAppear {
    startKeyboardMonitorIfNeeded()
}
.onDisappear {
    stopKeyboardMonitorIfNeeded()
}
```

---

## 注意事项

1. **生命周期管理**：确保在 `onDisappear` 中移除监听器
2. **窗口过滤**：始终检查 `event.window === window` 避免影响其他窗口
3. **修饰键检查**：⌥⌘←/→ 用于切换数据源，不要拦截
4. **鼠标焦点入口唯一**：由 `MainListView.swift` 的 TapGesture 统一处理
5. **动态字体缩放**：滚动步长需要考虑 `fontScaleManager.scaleFactor`
6. **Detail firstResponder 落点**：必须保留 `FirstResponderProxyView`
7. **空状态处理**：DetailView 的空状态也需要提供 ScrollView

---

## 扩展指南

### 添加新的快捷键

1. 在 `startKeyboardMonitorIfNeeded()` 的 switch 语句中添加新的 case
2. 确保正确检查 `keyboardNavigationTarget` 状态和修饰键
3. 返回 `nil` 消费事件，或返回 `event` 传递给系统

### 添加新的 DetailView

1. 添加 `onScrollViewResolved: (NSScrollView) -> Void` 参数
2. 使用 `EnclosingScrollViewReader` 获取 NSScrollView
3. 在 `MainListView+DetailViews.swift` 中传递回调
4. 确保空状态和加载状态也有可解析的 ScrollView

### 添加新的数据源 ListView

1. 添加 `@FocusState private var isListFocused: Bool`
2. 在 List 上添加 `.focused($isListFocused)`
3. 在 `.onAppear` 中设置焦点
4. 监听 `ContentSource.<source>.listFocusRequestedNotification`

---

## 相关文件

| 文件路径 | 作用 |
|---------|------|
| `MainListView.swift` | 主视图，定义状态变量和生命周期管理 |
| `MainListView+KeyboardMonitor.swift` | 键盘事件监听 + 滚动控制 |
| `MainListView+FocusManager.swift` | 焦点切换方法（List/Detail） |
| `Keyboard/WindowReader.swift` | 获取 NSWindow |
| `Keyboard/EnclosingScrollViewReader.swift` | 获取 NSScrollView |
| `Keyboard/FirstResponderProxyView.swift` | Detail 侧稳定 firstResponder |
