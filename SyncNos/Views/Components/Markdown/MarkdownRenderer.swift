import SwiftUI

#if canImport(Markdown)
import Markdown
#endif

/// 渲染入口（当前版本：优先保证透明背景与链接可点击）
/// - 说明：为确保稳定性，当前采用 `AttributedString(markdown:)` 渲染策略，
///   同时保留 `swift-markdown` 解析入口，后续可渐进替换为完全自定义节点渲染。
struct MarkdownRendererView: View {
    let originalText: String
    var theme: MarkdownRenderTheme = .init()

    var body: some View {
        Group {
            #if canImport(Markdown)
            // 触发 swift-markdown 的解析（便于未来扩展为自定义渲染）
            _ = MarkdownParser.parse(originalText)
            if let attributed = try? AttributedString(markdown: originalText) {
                Text(attributed)
                    .foregroundColor(theme.textPrimary)
            } else {
                Text(originalText)
                    .foregroundColor(theme.textPrimary)
            }
            #else
            Text(originalText)
                .foregroundColor(theme.textPrimary)
            #endif
        }
        .background(Color.clear)
    }
}


