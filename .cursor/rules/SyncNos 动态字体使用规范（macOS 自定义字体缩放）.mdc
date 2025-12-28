---
description: SyncNos 动态字体使用规范（macOS 自定义字体缩放）
alwaysApply: false
---

# SyncNos 动态字体使用规范（macOS 自定义字体缩放）

本项目采用自定义字体缩放方案（非系统 Dynamic Type）。实现位于 `Services/Core/FontScaleManager.swift`，请遵循以下规范：

## 核心组件
- **FontScaleManager.shared**
  - 属性：`scaleLevel`（离散等级）、`scaleFactor`（CGFloat）、`isAccessibilitySize`
  - 存储键：`SyncNos.FontScaleLevel`
  - 通知：`Notification.Name.fontScaleDidChange`
- **环境键**：`fontScale`（通过 `.applyFontScale()` 注入）
- **文本修饰符**：`scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil)`
- **视图修饰符**：`.applyFontScale()`（将 `fontScale` 注入当前视图层级）
- **辅助工具**：`Font.TextStyle.basePointSize`、`AdaptiveStack`

## 编码规范
1) **文本必须使用 `.scaledFont()`**  
   - 禁止使用 `.font(.headline)` / `.font(.body)` 等直接调用。  
   - 示例：`Text("Title").scaledFont(.headline, weight: .semibold)`

2) **根视图注入缩放**  
   - 对需要字体缩放的窗口/根视图调用 `.applyFontScale()`（已用于 `RootView`、`SettingsView` 等）。  
   - 新增独立窗口或顶层视图时，请确认添加。

3) **获取缩放因子：推荐方式**  
   - **首选**：`@Environment(\.fontScale) var fontScale`（适用于所有需要手工计算的场景，如图标/布局尺寸）。  
   - **备选**：`@ObservedObject private var fontScaleManager = FontScaleManager.shared`（仅当需要访问 `isAccessibilitySize` 等其他属性时使用）。
   - **禁止**：不要使用 `@EnvironmentObject FontScaleManager`，因为 `.applyFontScale()` 只注入了 `Environment(\.fontScale)`，未注入 `environmentObject`，会导致运行时崩溃。

4) **图标与布局尺寸缩放**  
   - 使用 `fontScale` 手工计算：例如 `Image(...).font(.system(size: 40 * fontScale))`。  
   - `AdaptiveStack` 或 `FontScaleManager.shared.isAccessibilitySize` 决定布局切换。

5) **特殊字体（等宽等）**  
   - 需要 monospaced 时可手动计算：`Font.TextStyle.caption.basePointSize * fontScale`，并指定 `design: .monospaced`。

6) **禁止事项**  
   - 不使用 `@ScaledMetric`、`DynamicTypeSize`（macOS 不响应）。  
   - 不直接写死 `.font(.system(size: ... * fontScale))` 来替代 `.scaledFont()`，除非是非文本元素或特殊字体场景。

7) **新增文本样式选择**  
   - 使用 `Font.TextStyle` 映射的基础字号（已在 `Font.TextStyle.basePointSize` 定义）。  
   - 需要自定义级别请优先用现有 `FontScaleLevel`。

8) **测试/预览**  
   - 预览中使用 `.applyFontScale()` 以保持一致效果。  
   - 手动调节：`TextSizeSettingsView`（滑块基于 `scaleLevel`）。

## 快捷键
- **⌘+** 放大字体（Increase Text Size）
- **⌘-** 缩小字体（Decrease Text Size）
- **⌘0** 重置字体（Reset Text Size）

快捷键实现位于 `Views/Settting/Commands/ViewCommands.swift`，调用 `FontScaleManager` 的 `increaseSize()`、`decreaseSize()`、`reset()` 方法。

## 参考文件
- 核心实现：`SyncNos/Services/Core/FontScaleManager.swift`
- 菜单命令：`SyncNos/Views/Settting/Commands/ViewCommands.swift`
- 设置界面：`SyncNos/Views/Settting/General/TextSizeSettingsView.swift`
- 视图覆盖示例：列表/详情/设置/Onboarding/IAP 等均已使用 `.scaledFont()`
