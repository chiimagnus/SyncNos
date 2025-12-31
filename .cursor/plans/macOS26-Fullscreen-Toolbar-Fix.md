# macOS 26 Tahoe 全屏模式工具栏黑边修复方案

## 问题描述

在 macOS 26 Tahoe 最新系统上，当使用 `fn+F` 将应用全屏时，顶部导航栏区域会出现黑边（"大黑疙瘩"）。

### 当前配置

1. **SyncNosApp.swift** (Line 90):
   ```swift
   .windowStyle(.hiddenTitleBar) // 隐藏标题栏
   ```

2. **MainListView.swift** (Line 270):
   ```swift
   .toolbarBackground(.hidden, for: .windowToolbar)
   ```

### 约束条件

- 用户**不希望**使用 `onHover`（自动隐藏）的工具栏效果
- 用户希望保持 `visible` 的工具栏显示效果
- **不能修改** `SyncNosApp.swift` 中的无关代码

---

## 技术分析

### 问题根因

macOS 26 Tahoe 在全屏模式下对 `.hiddenTitleBar` 和 `.toolbarBackground(.hidden)` 的组合处理方式发生了变化：

1. 系统仍然为工具栏/标题栏区域预留安全区域（Safe Area）
2. `.toolbarBackground(.hidden)` 隐藏了工具栏背景，但系统仍保留该区域
3. 在全屏模式下，这个预留区域没有任何内容填充，显示为黑色

### 解决思路

1. **P1 (优先级最高)**: 在 `MainListView.swift` 中调整 `.toolbarBackground` 配置，使用条件性显示
2. **P2 (次优先级)**: 使用 `.toolbarVisibility` 修饰符明确控制工具栏可见性
3. **P3 (备选)**: 如果 P1/P2 无效，考虑使用 `safeAreaInset` 或自定义背景填充

---

## Plan A 方案详情

### P1: 调整 toolbarBackground 配置

**文件**: `SyncNos/Views/Components/Main/MainListView.swift`

**修改位置**: Line 270

**当前代码**:
```swift
.toolbarBackground(.hidden, for: .windowToolbar)
```

**修改方案**:

在 macOS 15+ 上，`.toolbarBackground(.hidden)` 会导致工具栏区域完全透明，但在全屏模式下这可能导致问题。替换为使用条件性的工具栏可见性设置：

```swift
// 替换 .toolbarBackground(.hidden, for: .windowToolbar)
// 使用 .visible 保持工具栏始终可见，同时使用自动材质背景
.toolbarVisibility(.visible, for: .windowToolbar)
.toolbarBackground(.automatic, for: .windowToolbar)
```

**验证步骤**:
1. Build 项目确保无编译错误
2. 在 macOS 26 Tahoe 上测试全屏模式

---

### P2: 使用 ignoresSafeArea 扩展背景

如果 P1 不能完全解决问题，需要确保背景渐变色能够延伸到安全区域。

**文件**: `SyncNos/Views/Components/Main/MainListView.swift`

**修改位置**: Lines 254-269 (背景渐变)

**当前代码**:
```swift
.background {
    LinearGradient(...)
        .ignoresSafeArea()
}
```

这部分代码已经使用了 `.ignoresSafeArea()`，理论上应该覆盖整个窗口包括工具栏区域。如果仍有问题，可能需要：

```swift
.background {
    LinearGradient(...)
        .ignoresSafeArea(.all, edges: .all)
}
```

---

### P3: 移除 toolbarBackground 修饰符（如果需要）

如果 P1 和 P2 都不能解决问题，尝试完全移除 `.toolbarBackground(.hidden)` 修饰符，让系统使用默认的工具栏背景处理。

---

## 实施顺序

1. **首先**：实施 P1 ✅ 已完成
   - 将 `.toolbarBackground(.hidden, for: .windowToolbar)` 
   - 修改为 `.toolbarBackground(.automatic, for: .windowToolbar)`
2. **然后**：如果问题仍存在，实施 P2
3. **最后**：如果问题仍存在，实施 P3 或探索其他方案

---

## 注意事项

1. **不修改 SyncNosApp.swift** 中的无关代码（用户明确要求）
2. 保持现有的 UI/UX 体验（彩虹渐变背景、透明效果等）
3. 确保在非全屏模式下也能正常工作

---

## 参考资料

- SwiftUI `.toolbarVisibility` 文档: 控制工具栏可见性（visible/hidden/automatic）
- SwiftUI `.toolbarBackground` 文档: 控制工具栏背景样式
- macOS 26 Tahoe 窗口管理变化（Apple Developer Documentation）
