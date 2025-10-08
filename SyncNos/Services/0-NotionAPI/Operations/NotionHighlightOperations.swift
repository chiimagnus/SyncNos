import Foundation

/// Notion 高亮操作类
class NotionHighlightOperations {
    private let requestHelper: NotionRequestHelper
    private let helperMethods: NotionHelperMethods
    private let pageOperations: NotionPageOperations
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, helperMethods: NotionHelperMethods, pageOperations: NotionPageOperations, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.helperMethods = helperMethods
        self.pageOperations = pageOperations
        self.logger = logger
    }

    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        // 上层会批次调用此函数。这里实现安全的分片/降级递归，遇到单条失败尝试内容裁剪；仍失败则跳过该条，保证后续条目不被拖累。
        func buildBlock(for h: HighlightRow) -> [String: Any] {
            return helperMethods.buildBulletedListItemBlock(for: h, bookId: bookId, maxTextLength: NotionSyncConfig.maxTextLengthPrimary)
        }

        func appendSlice(_ slice: ArraySlice<HighlightRow>) async throws {
            let children = slice.map { buildBlock(for: $0) }
            // Delegate robust append behavior to pageOperations.appendChildrenWithRetry
            try await pageOperations.appendChildrenWithRetry(pageId: pageId, children: children)
        }

        // 入口：按默认批次一批，逐批递归发送
        let batchSize = NotionSyncConfig.defaultAppendBatchSize
        var index = 0
        while index < highlights.count {
            let slice = highlights[index..<min(index + batchSize, highlights.count)]
            try await appendSlice(slice)
            index += batchSize
        }
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        // 构建 parent rich_text（highlight + uuid）并更新；父块类型与创建时一致：numbered_list_item
        let parentRt = helperMethods.buildParentRichText(for: highlight, bookId: bookId)
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["numbered_list_item": ["rich_text": parentRt]])

        // 构建并替换子块（note + metadata+link）
        var childBlocks: [[String: Any]] = []
        if let noteChild = helperMethods.buildNoteChild(for: highlight) {
            childBlocks.append(noteChild)
        }
        childBlocks.append(helperMethods.buildMetaAndLinkChild(for: highlight, bookId: bookId))

        // 使用 pageOperations.replacePageChildren 来替换指定 block 的 children（适用于 block 的 children endpoint）
        try await pageOperations.replacePageChildren(pageId: blockId, with: childBlocks)
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
        let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId)

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
        let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

        // Replace page children with up-to-date content
        let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId)
        try await pageOperations.replacePageChildren(pageId: pageId, with: children)
    }
}
