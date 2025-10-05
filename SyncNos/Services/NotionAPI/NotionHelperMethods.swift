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

    // Build rich text for highlight bullet/list item
    func buildHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [[String: Any]] {
        var rt: [[String: Any]] = []

        // Highlight text with optional length limit
        let textContent = maxTextLength != nil && highlight.text.count > maxTextLength!
            ? String(highlight.text.prefix(maxTextLength!))
            : highlight.text
        rt.append(["text": ["content": textContent]])

        // Optional note with length limit
        if let note = highlight.note, !note.isEmpty {
            let noteContent = maxTextLength != nil && note.count > maxTextLength!
                ? String(note.prefix(maxTextLength!))
                : note
            rt.append(["text": ["content": " — Note: \(noteContent)"], "annotations": ["italic": true]])
        }

        // Add metadata when available
        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            rt.append(["text": ["content": " — \(metaString)"], "annotations": ["italic": true]])
        }

        // Link to open in Apple Books
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])

        // UUID marker for idempotency
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        return rt
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
