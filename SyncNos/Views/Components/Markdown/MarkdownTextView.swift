import SwiftUI

/// 外部使用的 Markdown 文本视图（透明背景）
struct MarkdownTextView: View {
    let text: String
    var theme: MarkdownRenderTheme = .init()

    init(text: String, theme: MarkdownRenderTheme = .init()) {
        self.text = text
        self.theme = theme
    }

    var body: some View {
        MarkdownRendererView(originalText: text, theme: theme)
            .background(Color.clear)
    }
}


