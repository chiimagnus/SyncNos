import Foundation

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

    // Build metadata string from highlight. `source` selects style->color mapping.
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



    // Build parent rich_text for nested-block approach (only highlight text)
    func buildParentRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [[String: Any]] {
        var rt: [[String: Any]] = []

        let textContent = truncateText(highlight.text, maxLen: maxTextLength)
        rt.append(["text": ["content": textContent]])

        // 在父级 rich_text 中也附加 UUID（code 注解），便于直接解析去重
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        return rt
    }

    // Build a paragraph child block for the note (italic)
    func buildNoteChild(for highlight: HighlightRow, maxTextLength: Int? = nil) -> [String: Any]? {
        guard let note = highlight.note, !note.isEmpty else { return nil }
        let noteContent = truncateText(note, maxLen: maxTextLength)
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

    // Build a paragraph child block containing metadata (italic) and UUID marker (code)
    // Metadata (style/added/modified) and uuid are placed together for easy parsing and updates.
    func buildMetaAndLinkChild(for highlight: HighlightRow, bookId: String, source: String = "appleBooks") -> [String: Any] {
        var rich: [[String: Any]] = []
        let metaString = buildMetadataString(for: highlight, source: source)
        if !metaString.isEmpty {
            rich.append(["text": ["content": metaString], "annotations": ["italic": true]])
        }
        // Append UUID as a separate rich text element with code annotation
        rich.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])
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
        let parent = buildParentRichText(for: highlight, bookId: bookId, maxTextLength: maxTextLength)
        var blocks: [[String: Any]] = []
        if let note = buildNoteChild(for: highlight, maxTextLength: maxTextLength) {
            blocks.append(note)
        }
        blocks.append(buildMetaAndLinkChild(for: highlight, bookId: bookId, source: source))
        return (parent, blocks)
    }

    // buildBulletedListItemBlock(for:bookId:maxTextLength:)：构建并返回一个完整的 Notion 列表项 block（现在使用数字列表），
    // 父级 rich_text 包含高亮文本，children 包含 note 与 metadata+uuid 子块。
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
    func buildPerBookPageChildren(for highlight: HighlightRow, bookId: String) -> [[String: Any]] {
        var children: [[String: Any]] = []
        // 1) Quote block for highlight text
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
        // 3) Metadata + Open link
        children.append(buildMetaAndLinkChild(for: highlight, bookId: bookId))
        return children
    }

    // General-purpose text truncation helper
    func truncateText(_ text: String, maxLen: Int?) -> String {
        guard let maxLen = maxLen, maxLen > 0 else { return text }
        return text.count > maxLen ? String(text.prefix(maxLen)) : text
    }

    // Trim long content inside a block's first rich_text element to maxLen.
    // Supports multiple common block owner keys (bulleted/numbered/paragraph/quote)
    func buildTrimmedBlock(_ block: [String: Any], to maxLen: Int) -> [String: Any] {
        var b = block

        func trimOwnerKey(_ ownerKey: String) -> Bool {
            if var owner = b[ownerKey] as? [String: Any] {
                if var rich = owner["rich_text"] as? [[String: Any]], !rich.isEmpty {
                    var first = rich[0]
                    if var text = first["text"] as? [String: Any], let content = text["content"] as? String, content.count > maxLen {
                        text["content"] = String(content.prefix(maxLen))
                        first["text"] = text
                        rich[0] = first
                        owner["rich_text"] = rich
                        b[ownerKey] = owner
                        return true
                    }
                }
            }
            return false
        }

        let ownerKeys = ["bulleted_list_item", "numbered_list_item", "paragraph", "quote"]
        for key in ownerKeys {
            if trimOwnerKey(key) { return b }
        }

        // Fallback: try to trim first child's rich_text if present
        if var children = b["children"] as? [[String: Any]], !children.isEmpty {
            var firstChild = children[0]
            var modified = false
            for key in ownerKeys {
                if var owner = firstChild[key] as? [String: Any], var rich = owner["rich_text"] as? [[String: Any]], !rich.isEmpty {
                    var first = rich[0]
                    if var text = first["text"] as? [String: Any], let content = text["content"] as? String, content.count > maxLen {
                        text["content"] = String(content.prefix(maxLen))
                        first["text"] = text
                        rich[0] = first
                        owner["rich_text"] = rich
                        firstChild[key] = owner
                        modified = true
                        break
                    }
                }
            }
            if modified {
                children[0] = firstChild
                b["children"] = children
            }
        }

        return b
    }

    // Build paragraph blocks from a long text (used by GoodLinks sync)
    func buildParagraphBlocks(from text: String, chunkSize: Int = 1500) -> [[String: Any]] {
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
        switch source {
        case "goodLinks":
            // GoodLinks 有自己的一套颜色编码，映射到与 UI 使用一致的颜色名
            // 对应 View 中 highlightColor(for:) 的映射：0: yellow, 1: green, 2: blue, 3: red, 4: purple
            switch style {
            case 0: return "yellow"
            case 1: return "green"
            case 2: return "blue"
            case 3: return "red"
            case 4: return "purple"
            default: return "mint"
            }
        default:
            // Apple Books mapping (existing)
            switch style {
            case 0: return "orange"
            case 1: return "green"
            case 2: return "blue"
            case 3: return "yellow"
            case 4: return "pink"
            case 5: return "purple"
            default: return "gray"
            }
        }
    }
}
