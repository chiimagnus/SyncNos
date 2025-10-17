import Foundation
import Markdown

/// 负责解析 Markdown 文本为文档结构；内部可按需加入缓存
enum MarkdownParser {
    private static var cache = NSCache<NSString, DocumentBox>()

    static func parse(_ text: String) -> Document {
        let key = NSString(string: String(text.hashValue))
        if let boxed = cache.object(forKey: key) {
            return boxed.document
        }
        let doc = Document(parsing: text)
        cache.setObject(DocumentBox(doc), forKey: key)
        return doc
    }
}

private final class DocumentBox: NSObject {
    let document: Document
    init(_ document: Document) { self.document = document }
}


