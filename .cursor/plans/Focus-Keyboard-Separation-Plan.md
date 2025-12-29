# 焦点管理与键盘导航分离计划

创建时间: 2025-12-29  
状态: 🟡 进行中

## 背景

当前 `MainListView+KeyboardMonitor.swift` 中的焦点管理和键盘导航逻辑高度耦合，导致：
1. 单个文件职责过多，不符合单一职责原则
2. 修改焦点逻辑时可能意外影响键盘导航
3. 难以独立测试和调试

## 当前代码结构

```
MainListView+KeyboardMonitor.swift (323行)
├── 键盘导航功能
│   ├── startKeyboardMonitorIfNeeded() — 键盘事件监听
│   ├── scrollCurrentDetail(byLines:) — 滚动控制
│   ├── scrollCurrentDetailToTop/Bottom() — 滚动到顶部/底部
│   ├── scrollCurrentDetailByPage() — 翻页
│   └── hasSingleSelectionForCurrentSource() — 选择状态检查
│
├── 焦点管理功能
│   ├── startMouseDownMonitorIfNeeded() — 鼠标点击监听
│   ├── syncNavigationTargetWithFocus() — 同步焦点状态
│   ├── focusDetailScrollViewIfPossible() — 聚焦到 Detail
│   ├── focusBackToMaster() — 返回聚焦到 List
│   └── focusNotificationName(for:) — 焦点通知名称映射
│
└── 生命周期管理
    └── stopKeyboardMonitorIfNeeded() — 移除所有监听器
```

## 目标结构

```
MainListView+KeyboardMonitor.swift — 键盘事件监听和滚动控制
├── startKeyboardMonitorIfNeeded()
├── stopKeyboardMonitorIfNeeded()
├── hasSingleSelectionForCurrentSource()
├── scrollCurrentDetail(byLines:)
├── scrollCurrentDetailToTop()
├── scrollCurrentDetailToBottom()
└── scrollCurrentDetailByPage(up:)

MainListView+FocusManager.swift — 焦点状态同步和切换
├── startMouseDownMonitorIfNeeded()
├── stopMouseDownMonitorIfNeeded()
├── syncNavigationTargetWithFocus()
├── focusDetailScrollViewIfPossible(window:)
├── focusBackToMaster(window:)
└── focusNotificationName(for:)
```

## 实施计划

### P1: 创建 MainListView+FocusManager.swift

新文件，包含所有焦点管理相关的方法：

```swift
import SwiftUI

// MARK: - MainListView Focus Manager Extension

extension MainListView {
    
    // MARK: - Mouse Monitor
    
    func startMouseDownMonitorIfNeeded()
    func stopMouseDownMonitorIfNeeded()
    
    // MARK: - Focus Sync
    
    func syncNavigationTargetWithFocus()
    
    // MARK: - Focus Helpers
    
    func focusDetailScrollViewIfPossible(window: NSWindow)
    func focusBackToMaster(window: NSWindow)
    func focusNotificationName(for source: ContentSource) -> Notification.Name
}
```

### P2: 精简 MainListView+KeyboardMonitor.swift

移除焦点管理相关代码，只保留键盘导航逻辑：

1. 移除 `startMouseDownMonitorIfNeeded()` 调用
2. 移除鼠标监听器的停止逻辑
3. 保留键盘事件处理和滚动控制

### P3: 更新 MainListView.swift

修改生命周期调用，分别调用两个模块：

```swift
.onAppear {
    // ... existing code
    startKeyboardMonitorIfNeeded()
    startMouseDownMonitorIfNeeded()  // 分开调用
}
.onDisappear {
    stopKeyboardMonitorIfNeeded()
    stopMouseDownMonitorIfNeeded()   // 分开调用
}
```

### P4: 验证和文档更新

1. 构建验证
2. 更新 `SyncNos 键盘导航技术文档.md`

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `MainListView+FocusManager.swift` | 新建 | 焦点管理扩展 |
| `MainListView+KeyboardMonitor.swift` | 修改 | 移除焦点相关代码 |
| `MainListView.swift` | 修改 | 更新生命周期调用 |
| `SyncNos 键盘导航技术文档.md` | 修改 | 更新文档结构说明 |

## 注意事项

1. **保持接口不变**：所有方法签名保持不变，只是代码位置迁移
2. **跨模块依赖**：键盘导航模块需要调用焦点管理模块的方法（如 `focusDetailScrollViewIfPossible`、`focusBackToMaster`）
3. **状态变量共享**：两个扩展共享 MainListView 的状态变量（`keyboardNavigationTarget`、`mouseDownMonitor` 等）

