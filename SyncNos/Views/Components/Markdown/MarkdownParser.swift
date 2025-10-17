import Foundation
import Markdown

/// 负责解析 Markdown 文本为文档结构；内部可按需加入缓存
enum MarkdownParser {
    static func parse(_ text: String) -> Document {
        return Document(parsing: text)
    }
}


