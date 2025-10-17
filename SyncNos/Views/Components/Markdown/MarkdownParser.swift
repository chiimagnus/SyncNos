import Foundation

#if canImport(Markdown)
import Markdown
#endif

/// 负责解析 Markdown 文本为文档结构；内部可按需加入缓存
enum MarkdownParser {
    #if canImport(Markdown)
    static func parse(_ text: String) -> Document {
        return Document(parsing: text)
    }
    #else
    // 未引入 `swift-markdown` 时的占位，不用于渲染，仅为编译通过
    static func parse(_ text: String) -> String { text }
    #endif
}


