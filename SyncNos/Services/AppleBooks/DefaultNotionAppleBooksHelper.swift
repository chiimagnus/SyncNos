import Foundation

class DefaultNotionAppleBooksHelper: NotionAppleBooksHelperProtocol {
    // Build iBooks link URL
    func buildIBooksLink(bookId: String, location: String?) -> String {
        if let loc = location, !loc.isEmpty {
            return "ibooks://assetid/\(bookId)#\(loc)"
        } else {
            return "ibooks://assetid/\(bookId)"
        }
    }

    func buildMetadataString(for highlight: HighlightRow) -> String {
        var metaParts: [String] = []
        if let s = highlight.style { metaParts.append("style:\(s)") }
        if let d = highlight.dateAdded { metaParts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(NotionServiceCore.isoDateFormatter.string(from: m))") }
        return metaParts.joined(separator: " | ")
    }

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

    func buildHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [[String: Any]] {
        var rt: [[String: Any]] = []

        let textContent = maxTextLength != nil && highlight.text.count > maxTextLength!
            ? String(highlight.text.prefix(maxTextLength!))
            : highlight.text
        rt.append(["text": ["content": textContent]])

        if let note = highlight.note, !note.isEmpty {
            let noteContent = maxTextLength != nil && note.count > maxTextLength!
                ? String(note.prefix(maxTextLength!))
                : note
            rt.append(["text": ["content": " — Note: \(noteContent)"], "annotations": ["italic": true]])
        }

        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            rt.append(["text": ["content": " — \(metaString)"], "annotations": ["italic": true]])
        }

        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])

        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        return rt
    }

    func buildHighlightChildren(bookId: String, highlight: HighlightRow) -> [[String: Any]] {
        var children: [[String: Any]] = []
        children.append([
            "object": "block",
            "quote": [
                "rich_text": [["text": ["content": highlight.text]]]
            ]
        ])
        if let note = highlight.note, !note.isEmpty {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [[
                        "text": ["content": note],
                        "annotations": ["italic": true]
                    ]]
                ]
            ])
        }
        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [[
                        "text": ["content": metaString],
                        "annotations": ["italic": true]
                    ]]
                ]
            ])
        }
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        children.append([
            "object": "block",
            "paragraph": [
                "rich_text": [[
                    "text": ["content": "Open ↗"],
                    "href": linkUrl
                ]]
            ]
        ])
        return children
    }

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

    func perBookDatabaseProperties(bookTitle: String, author: String, assetId: String) -> (title: String, properties: [String: Any]) {
        let dbTitle = "SyncNos - \(bookTitle)"
        let properties: [String: Any] = [
            NotionAppleBooksFields.text: ["title": [:]],
            NotionAppleBooksFields.uuid: ["rich_text": [:]],
            NotionAppleBooksFields.note: ["rich_text": [:]],
            NotionAppleBooksFields.style: ["rich_text": [:]],
            NotionAppleBooksFields.addedAt: ["date": [:]],
            NotionAppleBooksFields.modifiedAt: ["date": [:]],
            NotionAppleBooksFields.location: ["rich_text": [:]],
            NotionAppleBooksFields.bookId: ["rich_text": [:]],
            NotionAppleBooksFields.bookTitle: ["rich_text": [:]],
            NotionAppleBooksFields.author: ["rich_text": [:]],
            NotionAppleBooksFields.link: ["url": [:]]
        ]
        return (title: dbTitle, properties: properties)
    }

    func buildBookPageProperties(bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) -> (properties: [String: Any], children: [[String: Any]]) {
        var properties: [String: Any] = [
            NotionAppleBooksFields.name: [
                "title": [["text": ["content": bookTitle]]]
            ],
            NotionAppleBooksFields.assetId: [
                "rich_text": [["text": ["content": assetId]]]
            ],
            NotionAppleBooksFields.author: [
                "rich_text": [["text": ["content": author]]]
            ]
        ]
        if let urlString = urlString, !urlString.isEmpty {
            properties["URL"] = ["url": urlString]
        }
        var children: [[String: Any]] = []
        if let header = header, !header.isEmpty {
            children = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": header]]]
                ]
            ]]
        }
        return (properties: properties, children: children)
    }

    // Default parser for UUID markers like "[uuid:... ]"
    func extractUUID(from text: String) -> String? {
        if let startRange = text.range(of: "[uuid:") {
            let startIdx = startRange.upperBound
            if let endRange = text.range(of: "]", range: startIdx..<text.endIndex) {
                return String(text[startIdx..<endRange.lowerBound])
            }
        }
        return nil
    }

    var singleDBTitle: String { "SyncNos-AppleBooks" }
    var sourceKey: String { "appleBooks" }
}

protocol NotionAppleBooksHelperProtocol {
    func buildIBooksLink(bookId: String, location: String?) -> String
    func buildMetadataString(for highlight: HighlightRow) -> String
    func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool) -> [String: Any]
    func buildHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int?) -> [[String: Any]]
    func buildHighlightChildren(bookId: String, highlight: HighlightRow) -> [[String: Any]]
    func styleName(for style: Int) -> String
    func perBookDatabaseProperties(bookTitle: String, author: String, assetId: String) -> (title: String, properties: [String: Any])
    func buildBookPageProperties(bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) -> (properties: [String: Any], children: [[String: Any]])

    // Helpers for parsing/formatting and config
    func extractUUID(from text: String) -> String?
    var singleDBTitle: String { get }
    var sourceKey: String { get }
}