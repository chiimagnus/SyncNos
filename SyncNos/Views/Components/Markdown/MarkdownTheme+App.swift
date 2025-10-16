import SwiftUI
import MarkdownUI

// MARK: - App Markdown Theme

enum AppMarkdownTheme {
    /// App 统一的 Markdown 主题（基于 GitHub 风格，后续可按需微调）
    static var gitHubLike: Theme {
        Theme.gitHub
    }
}

// MARK: - Convenience modifiers

extension View {
    /// 应用应用内统一的 Markdown 默认修饰符：主题 + 文本可选
    func appMarkdownDefaults() -> some View {
        self
            .markdownTheme(AppMarkdownTheme.gitHubLike)
            .textSelection(.enabled)
    }
}


