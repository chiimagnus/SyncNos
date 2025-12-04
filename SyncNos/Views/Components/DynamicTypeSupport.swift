import SwiftUI

// MARK: - 应用内字体缩放支持

/// 由于 macOS 不支持系统级 Dynamic Type，我们使用 FontScaleManager 实现应用内字体缩放
/// 使用方法：
/// 1. 在根视图添加 .applyFontScale()
/// 2. 在需要缩放的视图中使用 @Environment(\.fontScale) private var fontScale
/// 3. 使用 .font(.system(size: Font.TextStyle.body.basePointSize * fontScale))

// MARK: - 应用内缩放视图修饰符

/// 应用字体缩放到整个视图层级的修饰符
struct AppFontScaleModifier: ViewModifier {
    @ObservedObject var fontScaleManager = FontScaleManager.shared
    
    func body(content: Content) -> some View {
        content
            .environment(\.fontScale, fontScaleManager.scaleFactor)
    }
}

extension View {
    /// 应用 FontScaleManager 的缩放因子到整个视图层级
    /// 应在应用的根视图上调用此方法
    func applyFontScale() -> some View {
        modifier(AppFontScaleModifier())
    }
}

// MARK: - 响应式布局辅助

/// 响应式布局容器：根据字体缩放级别自动切换水平/垂直布局
struct AdaptiveStack<Content: View>: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
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
        if fontScaleManager.isAccessibilitySize {
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

// MARK: - 预览辅助

#Preview("AdaptiveStack - Normal") {
    AdaptiveStack(spacing: 12) {
        Text("Item 1")
        Text("Item 2")
        Text("Item 3")
    }
    .padding()
}
