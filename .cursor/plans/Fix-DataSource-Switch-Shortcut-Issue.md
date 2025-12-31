# 数据源切换快捷键 (⌥⌘←/→) 被误消费问题修复计划

## 问题描述

在各个 datasource listview 时，键入 `Option+Cmd+右方向键` (⌥⌘→) 以切换到其他 datasource listview 时，结果竟然是从当前的 listview 进入到了 detailview，然后只有再次键入 `⌥⌘→` 才得以切换到右边一个数据源。

## 问题分析

### 涉及文件

| 文件 | 作用 |
|------|------|
| `Views/Commands/ViewCommands.swift` | 定义菜单快捷键 `⌥⌘←/→` 用于数据源切换 |
| `Views/Components/Main/MainListView+KeyboardMonitor.swift` | 键盘事件监听器，处理方向键导航 |

### 根本原因

在 `MainListView+KeyboardMonitor.swift` 的键盘监听器中，当用户按下 `⌥⌘→` 时：

1. **行 33-51**：检查 `hasCommand && !hasOption && !hasControl` → 不匹配（因为 hasOption 是 true）
2. **行 54-77**：检查 `hasOption && !hasCommand && !hasControl` → 不匹配（因为 hasCommand 是 true）
3. **行 79-82**：检查 `hasControl` → 不匹配
4. **行 84 开始**：进入 `switch event.keyCode` 处理，**这里没有检查是否同时按下了 Command + Option**
5. **行 92-99**：`→` 键（keyCode 124）被处理，进入 Detail 视图，事件被消费（返回 nil）
6. 结果：菜单系统的 `⌥⌘→` 快捷键无法收到事件

### 问题代码

```swift
// MainListView+KeyboardMonitor.swift 行 84-99

switch event.keyCode {
case 123: // ←
    if self.keyboardNavigationTarget == .detail {
        self.keyboardNavigationTarget = .list
        self.focusBackToMaster(window: window)
        return nil  // ← 被消费
    }
    return event
case 124: // →
    if self.keyboardNavigationTarget == .list, self.hasSingleSelectionForCurrentSource() {
        self.savedMasterFirstResponder = window.firstResponder
        self.keyboardNavigationTarget = .detail
        self.focusDetailIfPossible(window: window)
        return nil  // ← 问题：⌥⌘→ 也会走到这里并被消费！
    }
    return event
// ... 其他 case
```

## 修复计划

### P1: 添加 ⌥⌘ 组合键检查（优先级最高）

**修改文件**：`Views/Components/Main/MainListView+KeyboardMonitor.swift`

**修改位置**：在 `switch event.keyCode` 之前，添加对 `hasOption && hasCommand` 组合的检查

**修改内容**：

```swift
// 在行 79-82 之后，switch event.keyCode 之前添加：

// ⌥⌘←/→ 用于数据源切换（由 ViewCommands 处理），不拦截
if hasOption && hasCommand {
    return event
}

switch event.keyCode {
    // ... 原有代码不变
}
```

**原理**：当同时按下 Option + Command 键时，直接返回事件让菜单系统处理，不进入方向键的本地处理逻辑。

### 验证步骤

1. 构建项目：`xcodebuild -scheme SyncNos -configuration Debug build`
2. 运行应用，确认：
   - `⌥⌘→` 在 ListView 焦点时能正确切换到下一个数据源（不会先进入 Detail）
   - `⌥⌘←` 在 ListView 焦点时能正确切换到上一个数据源
   - 普通 `→` 键仍能正确从 List 进入 Detail
   - 普通 `←` 键仍能正确从 Detail 返回 List

## 技术背景

### 键盘事件处理优先级

在 macOS 中，`NSEvent.addLocalMonitorForEvents` 注册的监听器会在菜单快捷键之前接收事件。如果监听器返回 `nil`，事件会被消费，不会传递给菜单系统。

### 快捷键定义（ViewCommands.swift）

```swift
// 行 107-118
Button("Previous Data Source") {
    switchToPreviousDataSource()
}
.keyboardShortcut(.leftArrow, modifiers: [.command, .option])

Button("Next Data Source") {
    switchToNextDataSource()
}
.keyboardShortcut(.rightArrow, modifiers: [.command, .option])
```

## 相关文档

- `.cursor/plans/SyncNos 键盘导航技术文档.md` - 完整的键盘导航系统文档
