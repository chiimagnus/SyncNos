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

    // Build metadata string from highlight
    func buildMetadataString(for highlight: HighlightRow) -> String {
        var metaParts: [String] = []
        if let s = highlight.style { metaParts.append("style:\(s)") }
        if let d = highlight.dateAdded { metaParts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(NotionServiceCore.isoDateFormatter.string(from: m))") }
        return metaParts.joined(separator: " | ")
    }

    // Build highlight properties for per-book database
    func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool = false) -> [String: Any] {
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
            properties["Style"] = [
                "rich_text": [["text": ["content": styleName(for: style) + "_\(style)"]]]
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



    // Build parent rich_text for nested-block approach (only highlight text + uuid)
    func buildParentRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [[String: Any]] {
        var rt: [[String: Any]] = []

        let textContent = maxTextLength != nil && highlight.text.count > maxTextLength!
            ? String(highlight.text.prefix(maxTextLength!))
            : highlight.text
        rt.append(["text": ["content": textContent]])

        // UUID marker kept on parent for idempotency lookup
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        return rt
    }

    // Build a paragraph child block for the note (italic)
    func buildNoteChild(for highlight: HighlightRow, maxTextLength: Int? = nil) -> [String: Any]? {
        guard let note = highlight.note, !note.isEmpty else { return nil }
        let noteContent = maxTextLength != nil && note.count > maxTextLength!
            ? String(note.prefix(maxTextLength!))
            : note
        return [
            "object": "block",
            "paragraph": [
                "rich_text": [[
                    "text": ["content": noteContent],
                    "annotations": ["italic": true]
                ]]
            ]
        ]
    }

    // Build a paragraph child block containing metadata (italic) and Open link
    func buildMetaAndLinkChild(for highlight: HighlightRow, bookId: String) -> [String: Any] {
        var rich: [[String: Any]] = []
        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            rich.append(["text": ["content": metaString], "annotations": ["italic": true]])
        }
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        rich.append(["text": ["content": "  Open ↗"], "href": linkUrl])
        return [
            "object": "block",
            "paragraph": [
                "rich_text": rich
            ]
        ]
    }

    // Build parent rich_text and ordered child blocks for nested-block approach
    // Returns (parentRichText, childBlocks)
    func buildParentAndChildren(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> ([[String: Any]], [[String: Any]]) {
        let parent = buildParentRichText(for: highlight, bookId: bookId, maxTextLength: maxTextLength)
        var blocks: [[String: Any]] = []
        if let note = buildNoteChild(for: highlight, maxTextLength: maxTextLength) {
            blocks.append(note)
        }
        blocks.append(buildMetaAndLinkChild(for: highlight, bookId: bookId))
        return (parent, blocks)
    }

    // Build a single bulleted list item block for a highlight (parent rich_text + children)
    func buildBulletedListItemBlock(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [String: Any] {
        let (parentRt, childBlocks) = buildParentAndChildren(for: highlight, bookId: bookId, maxTextLength: maxTextLength)
        let bulleted: [String: Any] = [
            "rich_text": parentRt,
            "children": childBlocks
        ]
        return [
            "object": "block",
            "bulleted_list_item": bulleted
        ]
    }

    // Build children blocks for a per-book database page (quote, optional note, metadata+link)
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

    // Trim long content inside a bulleted block's first rich_text element to maxLen
    func buildTrimmedBlock(_ block: [String: Any], to maxLen: Int) -> [String: Any] {
        var b = block
        if var bulleted = b["bulleted_list_item"] as? [String: Any], var rich = bulleted["rich_text"] as? [[String: Any]], !rich.isEmpty {
            var first = rich[0]
            if var text = first["text"] as? [String: Any], let content = text["content"] as? String, content.count > maxLen {
                text["content"] = String(content.prefix(maxLen))
                first["text"] = text
                rich[0] = first
                bulleted["rich_text"] = rich
                b["bulleted_list_item"] = bulleted
            }
        }
        return b
    }

    // Build paragraph blocks from a long text (used by GoodLinks sync)
    func buildParagraphBlocks(from text: String, chunkSize: Int = 1800) -> [[String: Any]] {
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

    // Convert numeric style to human-friendly color name
    func styleName(for style: Int) -> String {
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
