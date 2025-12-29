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

2. **AppKit/SwiftUI 的双重性质**
   - macOS 上的 SwiftUI 视图底层是 AppKit（NSView）
   - `NSWindow.firstResponder` 是 AppKit 层控制焦点的**唯一权威**
   - SwiftUI 的 `@FocusState` 只是对 AppKit 状态的**反映/包装**

3. **我们的代码引入了自定义焦点管理**
   - 我们添加了 `keyboardNavigationTarget` 来实现键盘在 List/Detail 之间导航
   - 这本身就是对 AppKit 默认焦点行为的**覆盖/扩展**
   - 键盘导航正确是因为我们**主动调用了 `makeFirstResponder`**
   - 鼠标点击没有调用 `makeFirstResponder`，导致状态不一致

---

## 主要修复方案：方案 D（本质解决）

### 核心思路

**完全依赖 AppKit 的 firstResponder，移除自定义的 keyboardNavigationTarget 状态**

- 移除 `keyboardNavigationTarget` 枚举状态
- 通过监听 `NSWindow.firstResponder` 的变化来判断当前焦点位置
- 统一键盘和鼠标的焦点处理逻辑

### 为什么这是本质解决

- 不再维护"影子状态"（`keyboardNavigationTarget`）
- 唯一的焦点权威是 AppKit 的 `firstResponder`
- 行为完全统一，无论是键盘还是鼠标

---

## P1：实现 FirstResponder 监听机制

### 1.1 创建 FirstResponderObserver

**新建文件**：`SyncNos/Views/Components/Keyboard/FirstResponderObserver.swift`

```swift
import AppKit
import Combine

/// 监听窗口的 firstResponder 变化
final class FirstResponderObserver: ObservableObject {
    enum FocusLocation {
        case list
        case detail
        case other
    }
    
    @Published private(set) var focusLocation: FocusLocation = .list
    
    private var timer: Timer?
    private weak var window: NSWindow?
    private var listViewIdentifier: ObjectIdentifier?
    private var detailScrollView: NSScrollView?
    
    func startObserving(window: NSWindow) {
        self.window = window
        
        // 使用定时器轮询 firstResponder（因为 NSWindow 没有 KVO）
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.checkFirstResponder()
        }
    }
    
    func stopObserving() {
        timer?.invalidate()
        timer = nil
    }
    
    func setDetailScrollView(_ scrollView: NSScrollView?) {
        self.detailScrollView = scrollView
    }
    
    private func checkFirstResponder() {
        guard let window = window,
              let responder = window.firstResponder else { return }
        
        let newLocation = determineLocation(for: responder)
        if newLocation != focusLocation {
            focusLocation = newLocation
        }
    }
    
    private func determineLocation(for responder: NSResponder) -> FocusLocation {
        var current: NSResponder? = responder
        
        while let view = current as? NSView {
            // 检查是否在 DetailView 的 ScrollView 中
            if let detailSV = detailScrollView,
               view === detailSV || view.isDescendant(of: detailSV) {
                return .detail
            }
            current = view.superview
        }
        
        // 默认认为在 List 中（如果不在 detail）
        return .list
    }
}
```

### 1.2 修改 MainListView

**文件**：`MainListView.swift`

变更：
1. 移除 `@State private var keyboardNavigationTarget: NavigationTarget = .list`
2. 添加 `@StateObject private var focusObserver = FirstResponderObserver()`
3. 使用 `focusObserver.focusLocation` 替代 `keyboardNavigationTarget`

### 1.3 修改 MainListView+KeyboardMonitor.swift

变更：
1. 移除 `mouseDownMonitor` 和 `syncNavigationTargetWithFocus()`
2. 简化 `keyDown` 处理，只处理方向键导航，焦点变化交给 AppKit
3. 保留 `makeFirstResponder` 调用以支持键盘导航

---

## P2：移除各 ListView 的 @FocusState

### 目标

统一焦点管理，移除分散的 `@FocusState` 变量。

### 修改文件

- `AppleBooksListView.swift`
- `GoodLinksListView.swift`
- `WeReadListView.swift`
- `DedaoListView.swift`
- `ChatListView.swift`

### 变更内容

1. 移除 `@FocusState private var isListFocused: Bool`
2. 移除 `.focused($isListFocused)`
3. 移除 `.onAppear { isListFocused = true }` 和相关通知监听

### 替代方案

焦点变化由 AppKit 自动管理，List 的高亮颜色会自动跟随 firstResponder 变化。

---

## P3：清理和优化

### 3.1 移除不再需要的代码

- 移除 `NavigationTarget` 枚举
- 移除 `DataSourceSwitchedTo*` 通知中的焦点设置逻辑
- 清理 `startKeyboardMonitorIfNeeded()` 中的冗余代码

### 3.2 优化轮询机制（可选）

如果 0.1 秒的轮询间隔有性能问题：
- 可以只在窗口激活时轮询
- 可以使用更低频率（0.2-0.5秒）

### 3.3 添加单元测试（可选）

为 `FirstResponderObserver` 添加单元测试。

---

## 备选方案 A（快速修复 - 已废弃）

如果方案 D 实施过程中遇到问题，可以回退到方案 A：

**在 `leftMouseDown` 事件中调用 `makeFirstResponder`**

```swift
// MainListView+KeyboardMonitor.swift
func startMouseDownMonitorIfNeeded() {
    mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
        guard let self = self else { return event }
        guard let window = event.window else { return event }
        let locationInWindow = event.locationInWindow
        
        if let detailScrollView = self.currentDetailScrollView,
           let detailFrame = detailScrollView.superview?.convert(detailScrollView.frame, to: nil),
           detailFrame.contains(locationInWindow) {
            DispatchQueue.main.async {
                self.keyboardNavigationTarget = .detail
                window.makeFirstResponder(detailScrollView)
            }
        }
        return event
    }
}
```

---

## ⭐ 推荐方案 A3（最小改动修复）

**日期**：2025-12-29

### 核心思路

**只处理点击 Detail 的情况，不干预点击 List 的情况**

- 点击 Detail → 主动调用 `makeFirstResponder` → List 高亮变灰 ✅
- 点击 List → 不干预，AppKit 自然处理 → List 高亮保持蓝色 ✅

### 与方案 A 的区别

| 对比项 | 方案 A（之前尝试） | 方案 A3（推荐） |
|-------|-------------------|-----------------|
| 延迟检查 | asyncAfter 0.1秒 | 无延迟 |
| 获取位置 | mouseLocationOutsideOfEventStream | event.locationInWindow |
| 处理 List 点击 | 尝试同步状态 | 完全不处理 |
| 调用时机 | 延迟后 | 立即（在 async 中） |

### 代码实现

```swift
// MainListView+KeyboardMonitor.swift

func startMouseDownMonitorIfNeeded() {
    guard mouseDownMonitor == nil else { return }
    
    mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
        // 只处理 MainListView 所在窗口的事件
        guard let window = self.mainWindow, event.window === window else {
            return event
        }
        
        // 在事件发生时立即获取点击位置
        let clickLocation = event.locationInWindow
        
        // 只处理点击 Detail 的情况
        if let detailScrollView = self.currentDetailScrollView,
           let detailFrame = detailScrollView.superview?.convert(detailScrollView.frame, to: nil),
           detailFrame.contains(clickLocation) {
            // 在下一个 runloop 切换焦点（避免干扰当前点击处理）
            DispatchQueue.main.async {
                self.keyboardNavigationTarget = .detail
                _ = window.makeFirstResponder(detailScrollView.contentView)
            }
        }
        // 点击 List 时不做任何处理，让 AppKit 自然处理
        
        return event  // 始终返回 event，不消费
    }
}
```

### 需要删除的代码

移除 `syncNavigationTargetWithFocus()` 方法的调用（在 `startMouseDownMonitorIfNeeded()` 中）。

可以选择保留或删除 `syncNavigationTargetWithFocus()` 方法本身。

### 预估工作量

| 任务 | 预估时间 |
|------|----------|
| 修改 `startMouseDownMonitorIfNeeded()` | 5 分钟 |
| 测试所有数据源 | 15 分钟 |
| **总计** | **20 分钟** |

### 测试用例

1. [ ] 点击 ChatListView item → 高亮为蓝色
2. [ ] 点击 ChatDetailView → 高亮变灰
3. [ ] 其他 4 个数据源同样测试
4. [ ] 键盘 → 键 → 焦点移到 Detail，高亮变灰
5. [ ] 键盘 ← 键 → 焦点回到 List，高亮变蓝

---

## 实施步骤

### 第一阶段：P1（预估 1.5 小时）

1. [ ] 创建 `FirstResponderObserver.swift`
2. [ ] 修改 `MainListView.swift` 集成 observer
3. [ ] 修改 `MainListView+KeyboardMonitor.swift` 简化逻辑
4. [ ] 测试键盘导航是否正常
5. [ ] 测试鼠标点击焦点变化

### 第二阶段：P2（预估 30 分钟）

1. [ ] 修改 `AppleBooksListView.swift` 移除 @FocusState
2. [ ] 修改 `GoodLinksListView.swift` 移除 @FocusState
3. [ ] 修改 `WeReadListView.swift` 移除 @FocusState
4. [ ] 修改 `DedaoListView.swift` 移除 @FocusState
5. [ ] 修改 `ChatListView.swift` 移除 @FocusState
6. [ ] 全面测试所有数据源

### 第三阶段：P3（预估 30 分钟）

1. [ ] 清理不再需要的代码
2. [ ] 代码审查和优化
3. [ ] 更新文档

---

## 测试用例

### 键盘导航测试
- [ ] 按 → 键：焦点从 List 移到 Detail，List 高亮变灰
- [ ] 按 ← 键：焦点从 Detail 移到 List，List 高亮变蓝
- [ ] 按 ↑/↓ 键：在 List 中切换选中项

### 鼠标点击测试
- [ ] 点击 DetailView：List 高亮变灰
- [ ] 点击 ListView：List 高亮变蓝
- [ ] 点击 ListView 中的某一行：该行被选中，高亮为蓝色

### 混合操作测试
- [ ] 键盘导航到 Detail → 鼠标点击 List → 高亮正确
- [ ] 鼠标点击 Detail → 键盘按 ← → 焦点正确回到 List

### 数据源切换测试
- [ ] 切换数据源后，焦点行为正常
- [ ] 所有 5 个数据源都测试

---

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 轮询对性能有影响 | 低 | 低 | 可调整间隔或只在窗口激活时轮询 |
| firstResponder 判断不准确 | 中 | 中 | 仔细测试，必要时调整判断逻辑 |
| 与现有焦点逻辑冲突 | 低 | 高 | 可回退到方案 A |

---

## 预估总工作量

| 阶段 | 任务 | 预估时间 |
|------|------|----------|
| P1 | FirstResponder 监听机制 | 1.5 小时 |
| P2 | 移除各 ListView 的 @FocusState | 30 分钟 |
| P3 | 清理和优化 | 30 分钟 |
| **总计** | | **2.5 小时** |

---

## 文档更新

完成修复后需更新：
- `CLAUDE.md`：如有架构变化
- 本计划文档：标记已完成的任务

---

## 创建日期
2025-12-28

## 状态
🟡 待实施方案 A3

---

## 历史记录

### 方案 D 失败记录

**尝试日期**：2025-12-28

**失败原因**：
1. **键盘导航失效** - 移除 `@FocusState` 后，ListView 无法正确获取焦点
2. **List 点击时闪烁** - `mouseDownMonitor` 干扰了 List 的正常点击行为

**已撤回的更改**：所有代码更改已撤回，恢复到原始状态。

---

### 方案 A 尝试记录（2025-12-29）

**尝试日期**：2025-12-29

**尝试内容**：
1. 使用 `asyncAfter` 延迟 0.1 秒后调用 `syncNavigationTargetWithFocus()`
2. 使用 `mouseLocationOutsideOfEventStream` 获取鼠标位置
3. 尝试同时处理 List 和 Detail 的点击

**失败原因**：
1. 点击 List item 时，有时会错误地把焦点切换到 Detail
2. 延迟检查导致判断不准确

**已撤回的更改**：所有代码更改已撤回。

---

### 下一步：实施方案 A3

**日期**：2025-12-29

**核心改进**：
1. 使用 `event.locationInWindow` 立即获取点击位置（不延迟）
2. 只处理点击 Detail 的情况（不处理点击 List）
3. 使用 `DispatchQueue.main.async` 而不是 `asyncAfter`

见上方"推荐方案 A3"章节。
