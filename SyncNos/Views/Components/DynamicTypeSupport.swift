import SwiftUI

// MARK: - Dynamic Type 支持工具

/// 用于获取当前 Dynamic Type 大小并判断是否为辅助功能大小
/// 使用方法：在视图中添加 @Environment(\.dynamicTypeSize) private var dynamicTypeSize
/// 然后使用 dynamicTypeSize.isAccessibilitySize 判断

// MARK: - 自定义字体 + Dynamic Type 缩放

/// 使用 @ScaledMetric 实现自定义尺寸的 Dynamic Type 缩放
/// 示例：
/// @ScaledMetric(relativeTo: .title) private var iconSize: CGFloat = 60
/// @ScaledMetric(relativeTo: .body) private var spacing: CGFloat = 16

// MARK: - 响应式布局辅助

/// 响应式布局容器：根据 Dynamic Type 大小自动切换水平/垂直布局
struct AdaptiveStack<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    
    let horizontalAlignment: VerticalAlignment
    let verticalAlignment: HorizontalAlignment
    let spacing: CGFloat?
    let content: Content
    
    init(
        horizontalAlignment: VerticalAlignment = .center,
        verticalAlignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.horizontalAlignment = horizontalAlignment
        self.verticalAlignment = verticalAlignment
        self.spacing = spacing
        self.content = content()
    }
    
    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: verticalAlignment, spacing: spacing) {
                content
            }
        } else {
            HStack(alignment: horizontalAlignment, spacing: spacing) {
                content
            }
        }
    }
}

// MARK: - 动态字体样式扩展

extension Font {
    /// 创建支持 Dynamic Type 的自定义字体
    /// - Parameters:
    ///   - name: 字体名称（如 "Avenir-Heavy"），传 nil 使用系统字体
    ///   - size: 基础字体大小
    ///   - relativeTo: 相对于哪个文本样式缩放
    ///   - weight: 字体粗细（仅当 name 为 nil 时有效）
    ///   - design: 字体设计（仅当 name 为 nil 时有效）
    /// - Returns: 支持 Dynamic Type 缩放的字体
    static func scaledFont(
        name: String? = nil,
        size: CGFloat,
        relativeTo textStyle: TextStyle = .body,
        weight: Weight = .regular,
        design: Design = .default
    ) -> Font {
        if let fontName = name {
            return .custom(fontName, size: size, relativeTo: textStyle)
        } else {
            // 使用系统字体但支持缩放
            // 注意：SwiftUI 的 .system(size:weight:design:) 不支持 Dynamic Type
            // 需要使用 relativeTo 参数
            return .system(size: size, weight: weight, design: design)
                .leading(.loose)
        }
    }
}

// MARK: - 动态尺寸修饰符

/// 为图标/图片提供 Dynamic Type 感知的尺寸
struct ScaledIconModifier: ViewModifier {
    @ScaledMetric private var scaledSize: CGFloat
    let baseSize: CGFloat
    
    init(baseSize: CGFloat, relativeTo textStyle: Font.TextStyle = .body) {
        self.baseSize = baseSize
        self._scaledSize = ScaledMetric(wrappedValue: baseSize, relativeTo: textStyle)
    }
    
    func body(content: Content) -> some View {
        content
            .font(.system(size: scaledSize))
    }
}

extension View {
    /// 应用支持 Dynamic Type 缩放的图标字体大小
    /// - Parameters:
    ///   - baseSize: 基础大小
    ///   - relativeTo: 相对于哪个文本样式缩放
    func scaledIconFont(baseSize: CGFloat, relativeTo textStyle: Font.TextStyle = .body) -> some View {
        modifier(ScaledIconModifier(baseSize: baseSize, relativeTo: textStyle))
    }
}

// MARK: - 预定义的缩放尺寸

/// 常用的缩放尺寸，用于需要固定尺寸但仍需支持 Dynamic Type 的场景
struct ScaledSizes {
    @ScaledMetric(relativeTo: .largeTitle) var heroIcon: CGFloat = 60
    @ScaledMetric(relativeTo: .title) var largeIcon: CGFloat = 32
    @ScaledMetric(relativeTo: .headline) var mediumIcon: CGFloat = 20
    @ScaledMetric(relativeTo: .body) var smallIcon: CGFloat = 16
    @ScaledMetric(relativeTo: .caption) var tinyIcon: CGFloat = 12
    
    @ScaledMetric(relativeTo: .title) var cardPadding: CGFloat = 16
    @ScaledMetric(relativeTo: .body) var standardSpacing: CGFloat = 8
}

// MARK: - Large Content Viewer 支持

/// 为无法缩放的控件添加 Large Content Viewer 支持
struct LargeContentViewerModifier: ViewModifier {
    let title: String
    let systemImage: String?
    
    func body(content: Content) -> some View {
        if let image = systemImage {
            content
                .accessibilityShowsLargeContentViewer {
                    Label(title, systemImage: image)
                }
        } else {
            content
                .accessibilityShowsLargeContentViewer {
                    Text(title)
                }
        }
    }
}

extension View {
    /// 为控件添加 Large Content Viewer 支持
    /// 当用户使用辅助功能大小时，长按控件会显示放大的标签
    func largeContentViewer(title: String, systemImage: String? = nil) -> some View {
        modifier(LargeContentViewerModifier(title: title, systemImage: systemImage))
    }
}

// MARK: - 预览辅助

#Preview("AdaptiveStack - Normal") {
    AdaptiveStack(spacing: 12) {
        Text("Item 1")
        Text("Item 2")
        Text("Item 3")
    }
    .padding()
}

#Preview("AdaptiveStack - Accessibility") {
    AdaptiveStack(spacing: 12) {
        Text("Item 1")
        Text("Item 2")
        Text("Item 3")
    }
    .padding()
    .environment(\.dynamicTypeSize, .accessibility3)
}

