import Foundation

/// Notion 高亮操作类
class NotionHighlightOperations {
    private let requestHelper: NotionRequestHelper
    private let appleBooksHelper: NotionAppleBooksHelperProtocol
    private let pageOperations: NotionPageOperations
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, appleBooksHelper: NotionAppleBooksHelperProtocol, pageOperations: NotionPageOperations, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.appleBooksHelper = appleBooksHelper
        self.pageOperations = pageOperations
        self.logger = logger
    }

    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        // 上层会批次调用此函数。这里实现安全的分片/降级递归，遇到单条失败尝试内容裁剪；仍失败则跳过该条，保证后续条目不被拖累。
        func buildBlock(for h: HighlightRow) -> [String: Any] {
            let rt = appleBooksHelper.buildHighlightRichText(for: h, bookId: bookId, maxTextLength: 1800)
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
                    let rt = appleBooksHelper.buildHighlightRichText(for: h, bookId: bookId, maxTextLength: 1000)
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
        let rt = appleBooksHelper.buildHighlightRichText(for: highlight, bookId: bookId, maxTextLength: nil)
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["bulleted_list_item": ["rich_text": rt]])
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        let properties = appleBooksHelper.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: false)
        let children = appleBooksHelper.buildHighlightChildren(bookId: bookId, highlight: highlight)

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
        let properties = appleBooksHelper.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

        // Replace page children with up-to-date content
        let children = appleBooksHelper.buildHighlightChildren(bookId: bookId, highlight: highlight)
        try await pageOperations.replacePageChildren(pageId: pageId, with: children)
    }

}
