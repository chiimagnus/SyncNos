import SwiftUI

/// 主题与样式配置：控制字体、颜色、间距，保证文本层透明
struct MarkdownRenderTheme {
    // Typography
    var fontBody: Font = .body
    var fontMonospaced: Font = .system(.body, design: .monospaced)
    var fontHeading1: Font = .largeTitle.weight(.bold)
    var fontHeading2: Font = .title.weight(.bold)
    var fontHeading3: Font = .title2.weight(.semibold)
    var fontHeading4: Font = .title3.weight(.semibold)
    var fontHeading5: Font = .headline
    var fontHeading6: Font = .subheadline

    // Colors
    var textPrimary: Color = .primary
    var textSecondary: Color = .secondary
    var linkColor: Color = .blue
    var quoteLineColor: Color = .secondary.opacity(0.3)
    var codeBorderColor: Color = .secondary.opacity(0.15)

    // Spacing
    var blockSpacing: CGFloat = 10
    var paragraphSpacing: CGFloat = 8
    var listRowSpacing: CGFloat = 6
    var headingBottomSpacing: CGFloat = 6
    var codeBlockPadding: EdgeInsets = EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)

    // Helpers
    func fontForHeading(level: Int) -> Font {
        switch level {
        case 1: return fontHeading1
        case 2: return fontHeading2
        case 3: return fontHeading3
        case 4: return fontHeading4
        case 5: return fontHeading5
        default: return fontHeading6
        }
    }
}


