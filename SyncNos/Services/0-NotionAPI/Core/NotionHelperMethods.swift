import Foundation
import CryptoKit

/// Notion 服务辅助方法
class NotionHelperMethods {
    // MARK: - Shared helper methods

    // Build iBooks link URL
    func buildIBooksLink(bookId: String, location: String?) -> String {
        if let loc = location, !loc.isEmpty {
            return "ibooks://assetid/\(bookId)#\(loc)"
        } else {
            return "ibooks://assetid/\(bookId)"
        }
    }

    // Build legacy metadata string (kept for compatibility where needed)
    func buildMetadataString(for highlight: HighlightRow, source: String = "appleBooks") -> String {
        var metaParts: [String] = []
        if let s = highlight.style {
            let name = styleName(for: s, source: source)
            metaParts.append("style:\(name)")
        }
        if let d = highlight.dateAdded { metaParts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(NotionServiceCore.isoDateFormatter.string(from: m))") }
        return metaParts.joined(separator: " | ")
    }

    // MARK: - Unified header helpers

    /// Compute modified token for header second line.
    /// - Apple Books: use modified time if present; otherwise fall back to hash.
    /// - GoodLinks: always use hash (since source has no modified time).
    func computeModifiedToken(for highlight: HighlightRow, source: String) -> String {
        if source == "appleBooks", let m = highlight.modified {
            return NotionServiceCore.isoDateFormatter.string(from: m)
        }
        // Hash-based token
        let styleNameValue: String = {
            if let s = highlight.style { return styleName(for: s, source: source) }
            return ""
        }()
        let added = highlight.dateAdded.map { NotionServiceCore.isoDateFormatter.string(from: $0) } ?? ""
        let location = highlight.location ?? ""
        let normalizedText = highlight.text.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedNote = (highlight.note ?? "").replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let payload = [normalizedText, normalizedNote, styleNameValue, added, location].joined(separator: "\n")
        let digest = SHA256.hash(data: payload.data(using: .utf8) ?? Data())
        let fullHex = digest.compactMap { String(format: "%02x", $0) }.joined()
        let short = String(fullHex.prefix(16))
        return short
    }

    /// Build two header lines as rich_text fragments: [uuid:...] and metadata (style|added|modified)
    func makeHeaderLines(for highlight: HighlightRow, source: String) -> [[String: Any]] {
        var rt: [[String: Any]] = []
        // Line 1: UUID (gray background), with trailing newline
        let uuidPrefix = "[uuid:\(highlight.uuid)]\n"
        rt.append([
            "text": ["content": uuidPrefix],
            "annotations": ["color": "gray_background"]
        ])

        // Line 2: metadata (style | added | modified TOKEN), with trailing newline
        var parts: [String] = []
        if let s = highlight.style {
            parts.append("style:\(styleName(for: s, source: source))")
        }
        if let d = highlight.dateAdded {
            parts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))")
        }
        let token = computeModifiedToken(for: highlight, source: source)
        parts.append("modified:\(token)")
        let metaLine = parts.joined(separator: " | ") + "\n"
        rt.append([
            "text": ["content": metaLine],
            "annotations": ["color": "gray_background"]
        ])
        return rt
    }

    // Build highlight properties for per-book database
    func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool = false, source: String = "appleBooks") -> [String: Any] {
        var properties: [String: Any] = [
            "Text": [
                "title": [["text": ["content": highlight.text]]]
            ],
            "UUID": [
                "rich_text": [["text": ["content": highlight.uuid]]]
            ],
            "Book ID": [
                "rich_text": [["text": ["content": bookId]]]
            ],
            "Book Title": [
                "rich_text": [["text": ["content": bookTitle]]]
            ],
            "Author": [
                "rich_text": [["text": ["content": author]]]
            ]
        ]

        if let note = highlight.note, !note.isEmpty {
            properties["Note"] = ["rich_text": [["text": ["content": note]]]]
        } else if clearEmpty {
            properties["Note"] = ["rich_text": []]
        }

        if let style = highlight.style {
            let colorName = styleName(for: style, source: source)
            properties["Style"] = [
                "rich_text": [["text": ["content": colorName]]]
            ]
        } else if clearEmpty {
            properties["Style"] = ["rich_text": []]
        }

        if let added = highlight.dateAdded {
            properties["Added At"] = [
                "date": [
                    "start": NotionServiceCore.isoDateFormatter.string(from: added)
                ]
            ]
        }

        if let modified = highlight.modified {
            properties["Modified At"] = [
                "date": [
                    "start": NotionServiceCore.isoDateFormatter.string(from: modified)
                ]
            ]
        }

        if let loc = highlight.location, !loc.isEmpty {
            properties["Location"] = ["rich_text": [["text": ["content": loc]]]]
        } else if clearEmpty {
            properties["Location"] = ["rich_text": []]
        }

        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        properties["Link"] = ["url": linkUrl]

        return properties
    }

    // Build parent rich_text for nested-block approach (two header lines + first text chunk)
    func buildParentRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil, source: String = "appleBooks") -> [[String: Any]] {
        var rt: [[String: Any]] = []
        // Header lines
        rt.append(contentsOf: makeHeaderLines(for: highlight, source: source))

        // First chunk of highlight text
        let chunkSize = maxTextLength ?? NotionSyncConfig.maxTextLengthPrimary
        let chunks = chunkText(highlight.text, chunkSize: chunkSize)
        let textContent = chunks.first ?? ""
        rt.append(["text": ["content": textContent]])
        return rt
    }

    // Build a paragraph child block for the note (italic)
    func buildNoteChild(for highlight: HighlightRow, maxTextLength: Int? = nil) -> [String: Any]? {
        guard let note = highlight.note, !note.isEmpty else { return nil }
        // 破坏性变更：移除运行时裁剪，依赖分块机制处理长文本
        let noteContent = note
        return [
            "object": "block",
            "bulleted_list_item": [
                "rich_text": [[
                    "text": ["content": noteContent],
                    "annotations": ["italic": true]
                ]]
            ]
        ]
    }

    func buildMetaAndLinkChild(for highlight: HighlightRow, bookId: String, source: String = "appleBooks") -> [String: Any] {
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        let rich: [[String: Any]] = [[
            "text": [
                "content": "Open in iBooks",
                "link": ["url": linkUrl]
            ]
        ]]
        return [
            "object": "block",
            "paragraph": [
                "rich_text": rich
            ]
        ]
    }

    // Build parent rich_text and ordered child blocks for nested-block approach
    // Returns (parentRichText, childBlocks)
    func buildParentAndChildren(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil, source: String = "appleBooks") -> ([[String: Any]], [[String: Any]]) {
        let parent = buildParentRichText(for: highlight, bookId: bookId, maxTextLength: maxTextLength, source: source)
        let chunkSize = maxTextLength ?? NotionSyncConfig.maxTextLengthPrimary

        var blocks: [[String: Any]] = []
        // 1) 高亮续块（从第二段起）使用 paragraph 子块
        blocks.append(contentsOf: buildHighlightContinuationChildren(for: highlight, chunkSize: chunkSize))
        // 2) note 切分为多个兄弟 bulleted_list_item
        blocks.append(contentsOf: buildNoteChildren(for: highlight, chunkSize: chunkSize))
        return (parent, blocks)
    }

    // buildBulletedListItemBlock(for:bookId:maxTextLength:)：构建并返回一个完整的 Notion 列表项 block（现在使用数字列表），
    // 父级 rich_text 包含高亮文本，children 包含 note 与 metadata 子块。
    func buildBulletedListItemBlock(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil, source: String = "appleBooks") -> [String: Any] {
        let (parentRt, childBlocks) = buildParentAndChildren(for: highlight, bookId: bookId, maxTextLength: maxTextLength, source: source)
        let numbered: [String: Any] = [
            "rich_text": parentRt,
            "children": childBlocks
        ]
        return [
            "object": "block",
            "numbered_list_item": numbered
        ]
    }

    // buildPerBookPageChildren(for:bookId:)：为“每书库（per-book DB）”构建页面子块列表（用于 pages 的 children），包括：1) 引用（quote）块显示高亮文本；2) 可选的 note 段落；3) metadata + Open 链接段落。
    func buildPerBookPageChildren(for highlight: HighlightRow, bookId: String, source: String = "appleBooks") -> [[String: Any]] {
        var children: [[String: Any]] = []
        children.append([
            "object": "block",
            "quote": [
                "rich_text": [["text": ["content": highlight.text]]]
            ]
        ])
        // 2) Note block if exists
        if let noteChild = buildNoteChild(for: highlight) {
            children.append(noteChild)
        }
        return children
    }

    // 注意：truncateText 已被移除，分块策略代替裁剪行为

    /// 通用文本分块：优先按段落与字符边界，单块最大 chunkSize。
    /// 结果至少包含一个元素（可能为空字符串）。
    func chunkText(_ text: String, chunkSize: Int = NotionSyncConfig.maxTextLengthPrimary) -> [String] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        var parts: [String] = []

        // 先按段落拆分（双换行）
        let paragraphs = normalized
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        for p in paragraphs {
            var start = p.startIndex
            while start < p.endIndex {
                let end = p.index(start, offsetBy: chunkSize, limitedBy: p.endIndex) ?? p.endIndex
                let slice = String(p[start..<end])
                parts.append(slice)
                start = end
            }
        }

        if parts.isEmpty {
            return [""]
        }
        return parts
    }

    /// 构建高亮续块（从第二段起）的 paragraph 子块
    func buildHighlightContinuationChildren(for highlight: HighlightRow, chunkSize: Int = NotionSyncConfig.maxTextLengthPrimary) -> [[String: Any]] {
        let chunks = chunkText(highlight.text, chunkSize: chunkSize)
        guard chunks.count > 1 else { return [] }
        var children: [[String: Any]] = []
        for c in chunks.dropFirst() {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [["text": ["content": c]]]
                ]
            ])
        }
        return children
    }

    /// 将 note 切分为多个兄弟 bulleted_list_item 子块（斜体）
    func buildNoteChildren(for highlight: HighlightRow, chunkSize: Int = NotionSyncConfig.maxTextLengthPrimary) -> [[String: Any]] {
        guard let note = highlight.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty else { return [] }
        let chunks = chunkText(note, chunkSize: chunkSize)
        return chunks.map { chunk in
            [
                "object": "block",
                "bulleted_list_item": [
                    "rich_text": [[
                        "text": ["content": chunk],
                        "annotations": ["italic": true]
                    ]]
                ]
            ]
        }
    }

    // Build paragraph blocks from a long text (used by GoodLinks sync)
    func buildParagraphBlocks(from text: String, chunkSize: Int = NotionSyncConfig.maxTextLengthPrimary) -> [[String: Any]] {
        let paragraphs = text.replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var children: [[String: Any]] = []
        for p in paragraphs {
            var start = p.startIndex
            while start < p.endIndex {
                let end = p.index(start, offsetBy: chunkSize, limitedBy: p.endIndex) ?? p.endIndex
                let slice = String(p[start..<end])
                children.append([
                    "object": "block",
                    "paragraph": [
                        "rich_text": [["text": ["content": slice]]]
                    ]
                ])
                start = end
            }
        }
        return children
    }

    // Convert numeric style to human-friendly color name. Mapping differs per source.
    func styleName(for style: Int, source: String = "appleBooks") -> String {
        let src: HighlightSource = (source == "goodLinks") ? .goodLinks : .appleBooks
        let def = HighlightColorScheme.definition(for: style, source: src)
        return def.notionName
    }
}
