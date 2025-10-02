# 冻结布局（MVP）实现说明

## 目标
在 macOS 窗口拖拽调整大小（live-resize）期间，冻结复杂布局计算（例如瀑布流 Waterfall 布局），以减少实时重排和 CPU 使用，提升拖拽流畅度。仅在用户释放鼠标后一次性恢复并更新布局。

## 关键点（实现最小可行产品）
- 监听 macOS 窗口 live-resize 事件：实现 `LiveResizeObserver`（`NSViewRepresentable`），通过 `viewWillStartLiveResize` / `viewDidEndLiveResize` 将是否正在调整大小的状态暴露给 SwiftUI。
- 测量并缓存内容宽度：在 `BookDetailView` 中使用 `GeometryReader` 获取当前 detail 区域的宽度并缓存为 `measuredLayoutWidth`。
- 冻结策略：在开始 live-resize 时把当前测量宽度写入 `frozenLayoutWidth`；在 live-resize 结束时清空 `frozenLayoutWidth`。
- 局部冻结实现：不再通过外层 `.frame(width:)` 固定 detail 区域（避免影响 `NavigationSplitView` 侧边栏布局），而是将 `frozenLayoutWidth` 传入 `WaterfallLayout` 的 `overrideWidth` 参数，仅用于内部列计算和放置。

## 代码变更概要
- 新增 `LiveResizeObserver`（`NSViewRepresentable`），位于 `SyncNos/Views/BookDetailView.swift` 顶部附近。
- 为 `BookDetailView` 增加状态：`isLiveResizing: Bool`、`measuredLayoutWidth: CGFloat`、`frozenLayoutWidth: CGFloat?`。
- 修改 `WaterfallLayout`：增加可选属性 `overrideWidth: CGFloat?`，在 `sizeThatFits` 与 `placeSubviews` 中使用该值进行内部计算，但对父视图仍报告原始 proposal 宽度以避免外层布局被挤压。
- 在 `BookDetailView` 中通过 `GeometryReader` 测量宽度并在 live-resize 期间设置 `frozenLayoutWidth`，将其传给 `WaterfallLayout(minColumnWidth:spacing:overrideWidth:)`。

## 设计理由
- 将冻结粒度限制在布局内部，避免更改父容器的尺寸测量，从而不会影响 `NavigationSplitView` 或侧边栏行为。
- 使用 macOS 原生 live-resize 回调精确把握拖拽周期，兼容 SwiftUI 的主线程状态更新。
- 实现保持最小且可逆：只在 `BookDetailView` 内部改动，易于回退或扩展（例如加入防抖、节流或基于帧率的动态策略）。

## 使用说明
- 在 macOS 上运行应用，进入书籍详情页，拖拽窗口改变大小时页面（尤其是瀑布流）将保持列布局不变；拖拽结束后布局会一次性更新到最终宽度。

## 后续改进（可选）
- 在冻结期间显示轻量占位/遮罩，提示用户“实时布局已冻结”。
- 根据窗口大小变化速率动态选择是否冻结（阈值判断）。
- 将该策略推广至其他重排频繁的视图组件。

可查看git修改：https://github.com/chiimagnus/SyncNos/commit/9adad35ddf36d31f261fdf4cd0e4e9b0551e8d82

https://github.com/chiimagnus/SyncNos/commit/c9da12d98a463e425bed01de1036a9046ab186d2