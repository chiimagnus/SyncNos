import Foundation

/// Notion 高亮操作类
class NotionHighlightOperations {
    private let requestHelper: NotionRequestHelper
    private let pageOperations: NotionPageOperations
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, pageOperations: NotionPageOperations, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.pageOperations = pageOperations
        self.logger = logger
    }

    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        // 上层会批次调用此函数。这里实现安全的分片/降级递归，遇到单条失败尝试内容裁剪；仍失败则跳过该条，保证后续条目不被拖累。
        func buildBlock(for h: HighlightRow) -> [String: Any] {
            let rt = Self.buildDefaultHighlightRichText(for: h, bookId: bookId, maxTextLength: 1800)
            return [
                "object": "block",
                "bulleted_list_item": ["rich_text": rt]
            ]
        }

        func appendSlice(_ slice: ArraySlice<HighlightRow>) async throws {
            let children = slice.map { buildBlock(for: $0) }
            do {
                try await pageOperations.appendBlocks(pageId: pageId, children: children)
            } catch {
                // 如果一批失败，且数量>1，切半递归重试；数量==1 时尝试更激进的裁剪（再次失败则跳过）
                if slice.count > 1 {
                    let mid = slice.startIndex + slice.count / 2
                    try await appendSlice(slice[slice.startIndex..<mid])
                    try await appendSlice(slice[mid..<slice.endIndex])
                } else if let h = slice.first {
                    // 单条仍失败：进一步强裁剪文本到 1000
                    let rt = Self.buildDefaultHighlightRichText(for: h, bookId: bookId, maxTextLength: 1000)
                    let child: [[String: Any]] = [[
                        "object": "block",
                        "bulleted_list_item": ["rich_text": rt]
                    ]]
                    do {
                        try await pageOperations.appendBlocks(pageId: pageId, children: child)
                    } catch {
                        // 彻底放弃该条，记录并跳过，避免整本失败
                        logger.warning("Skip one highlight due to Notion API error: uuid=\(h.uuid) message=\(error.localizedDescription)")
                    }
                }
            }
        }

        // 入口：按 80 一批，逐批递归发送
        let batchSize = 80
        var index = 0
        while index < highlights.count {
            let slice = highlights[index..<min(index + batchSize, highlights.count)]
            try await appendSlice(slice)
            index += batchSize
        }
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        // 构建富文本内容
        let rt = Self.buildDefaultHighlightRichText(for: highlight, bookId: bookId, maxTextLength: nil)
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["bulleted_list_item": ["rich_text": rt]])
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        let properties = Self.buildDefaultHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: false)
        let children = Self.buildDefaultHighlightChildren(bookId: bookId, highlight: highlight)

        let body: [String: Any] = [
            "parent": [
                "type": "database_id",
                "database_id": databaseId
            ],
            "properties": properties,
            "children": children
        ]
        let data = try await requestHelper.performRequest(path: "pages", method: "POST", body: body)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }

    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        let properties = Self.buildDefaultHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

        // Replace page children with up-to-date content
        let children = Self.buildDefaultHighlightChildren(bookId: bookId, highlight: highlight)
        try await pageOperations.replacePageChildren(pageId: pageId, with: children)
    }

    // MARK: - Default builders kept in NotionAPI for safety
    private static func buildDefaultHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool) -> [String: Any] {
        var properties: [String: Any] = [
            NotionAppleBooksFields.text: [
                "title": [["text": ["content": highlight.text]]]
            ],
            NotionAppleBooksFields.uuid: [
                "rich_text": [["text": ["content": highlight.uuid]]]
            ],
            NotionAppleBooksFields.bookId: [
                "rich_text": [["text": ["content": bookId]]]
            ],
            NotionAppleBooksFields.bookTitle: [
                "rich_text": [["text": ["content": bookTitle]]]
            ],
            NotionAppleBooksFields.author: [
                "rich_text": [["text": ["content": author]]]
            ]
        ]

        if let note = highlight.note, !note.isEmpty {
            properties[NotionAppleBooksFields.note] = ["rich_text": [["text": ["content": note]]]]
        } else if clearEmpty {
            properties[NotionAppleBooksFields.note] = ["rich_text": []]
        }

        if let style = highlight.style {
            properties[NotionAppleBooksFields.style] = [
                "rich_text": [["text": ["content": "\(style)"]]]
            ]
        } else if clearEmpty {
            properties[NotionAppleBooksFields.style] = ["rich_text": []]
        }

        if let added = highlight.dateAdded {
            properties[NotionAppleBooksFields.addedAt] = [
                "date": [
                    "start": NotionServiceCore.isoDateFormatter.string(from: added)
                ]
            ]
        }

        if let modified = highlight.modified {
            properties[NotionAppleBooksFields.modifiedAt] = [
                "date": [
                    "start": NotionServiceCore.isoDateFormatter.string(from: modified)
                ]
            ]
        }

        if let loc = highlight.location, !loc.isEmpty {
            properties[NotionAppleBooksFields.location] = ["rich_text": [["text": ["content": loc]]]]
        } else if clearEmpty {
            properties[NotionAppleBooksFields.location] = ["rich_text": []]
        }

        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        properties[NotionAppleBooksFields.link] = ["url": linkUrl]

        return properties
    }

    private static func buildDefaultHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int?) -> [[String: Any]] {
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
        var metaParts: [String] = []
        if let d = highlight.dateAdded { metaParts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(NotionServiceCore.isoDateFormatter.string(from: m))") }
        if !metaParts.isEmpty {
            rt.append(["text": ["content": " — \(metaParts.joined(separator: " | "))"], "annotations": ["italic": true]])
        }
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])
        return rt
    }

    private static func buildDefaultHighlightChildren(bookId: String, highlight: HighlightRow) -> [[String: Any]] {
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
        var metaParts: [String] = []
        if let d = highlight.dateAdded { metaParts.append("added:\(NotionServiceCore.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(NotionServiceCore.isoDateFormatter.string(from: m))") }
        if !metaParts.isEmpty {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [[
                        "text": ["content": metaParts.joined(separator: " | ")],
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

    private static func buildIBooksLink(bookId: String, location: String?) -> String {
        if let loc = location, !loc.isEmpty {
            return "ibooks://assetid/\(bookId)#\(loc)"
        } else {
            return "ibooks://assetid/\(bookId)"
        }
    }

}
