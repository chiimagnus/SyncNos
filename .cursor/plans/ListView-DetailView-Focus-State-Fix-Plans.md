# ListView / DetailView 焦点状态修复方案（最终版：P4）✅ 已完成

## 实施总结

✅ **P4 方案已落地并验证通过（破坏性重构，替代 P1）**
- **实施时间**：2025-12-30
- **关键改动**
  - 移除全局 `mouseDownMonitor` 路线（不再依赖 NSEvent 命中测试）
  - 在 `NavigationSplitView` 的 master/detail 两侧使用 SwiftUI `TapGesture` 显式更新 `keyboardNavigationTarget`
  - 新增 `FirstResponderProxyView` 作为 Detail 侧稳定的 firstResponder 落点
- **修改文件**
  - `SyncNos/Views/Components/Main/MainListView.swift`
  - `SyncNos/Views/Components/Main/MainListView+FocusManager.swift`
  - `SyncNos/Views/Components/Keyboard/FirstResponderProxyView.swift`
- **验证结果**
  - ✅ 点击 List：保持 List 焦点（高亮为强调色），↑/↓ 正常
  - ✅ 点击 Detail：焦点切到 Detail（List 进入非激活态）
  - ✅ 键盘 ←/→ / ↑/↓（Chats）导航不受影响

---

## 背景与目标

### 现象
- 键盘 ←/→ 导航能够正确触发 List 高亮「强调色 ↔ 非激活态」
- 但鼠标点击 Detail 时，Detail 侧经常拿不到 firstResponder，导致 List 高亮不进入非激活态（尤其在 Chats / 空状态 / 覆盖层场景）

### 目标行为
- 焦点在 **List**：选中项高亮为 **强调色**
- 焦点在 **Detail**：List 选中项高亮为 **非激活态**

---

## 根因（最终确认）

- SwiftUI 的 Detail 视图（ScrollView/空状态/覆盖层）在鼠标点击后并不总能产生「可用的 firstResponder」
- 依赖 `NSEvent.addLocalMonitorForEvents` + hitTest/rect 去推断「点击发生在 Detail」会引入：
  - 覆盖层导致 hitTest 命中不稳定
  - ScrollView 重建导致引用/时机竞态
  - 误判风险（点 List 也可能触发切到 Detail）

---

## 最终方案（P4：从源头解决）

### 1) 用 SwiftUI 手势替代全局鼠标监听器

在 `MainListView` 的 `NavigationSplitView` 两侧显式处理鼠标点击：
- masterColumn：点击即 `keyboardNavigationTarget = .list`
- detailColumn：点击（且单选）即 `keyboardNavigationTarget = .detail`，并触发 `focusDetailIfPossible(window:)`

### 2) Detail 侧引入稳定的 firstResponder 落点

新增 `FirstResponderProxyView`（透明 NSView，`acceptsFirstResponder == true`），作为 Detail 抢焦点的兜底目标：
- `MainListView.swift`：在 detailColumn `.background(FirstResponderProxyView(view: $detailFirstResponderProxyView))`
- `MainListView+FocusManager.swift`：`focusDetailIfPossible` 通过 `window.makeFirstResponder(detailFirstResponderProxyView)` 切换焦点

---

## 验证步骤

- 在任意数据源选中一个条目（确保右侧有 Detail）
- 鼠标点击 Detail（空白/内容/空状态）：左侧选中高亮应进入非激活态
- 鼠标点击 List：高亮恢复强调色，并可用 ↑/↓ 导航
- 键盘 →/←：行为一致；Chats 的 ↑/↓ 消息导航正常
- 构建：`xcodebuild -scheme SyncNos -configuration Debug -destination "platform=macOS" build`

---

## 历史方案（P1/P2/P3）说明

- **P1**：基于 `mouseDownMonitor` + 命中测试补焦点 —— 在 Chats 等覆盖层场景仍可能失效/误判
- **P2**：在 detailColumn 叠加 AppKit 捕获层 —— 已被 P4 更内聚的 SwiftUI 手势方案替代
- **P3**：移除 List 的 FocusState —— 不再需要（P4 已从「焦点落点 + 切换入口」解决）
