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
            // 破坏性变更：直接按批次追加，不再尝试单条裁剪或降级
            try await pageOperations.appendChildren(pageId: pageId, children: children)
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

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String, source: String) async throws {
        // 构建 parent rich_text（高亮首段）并更新；父块类型与创建时一致：numbered_list_item
        let parentRt = helperMethods.buildParentRichText(for: highlight, bookId: bookId, maxTextLength: NotionSyncConfig.maxTextLengthPrimary, source: source)
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["numbered_list_item": ["rich_text": parentRt]])

        // 构建并替换子块（高亮续块 + note 多块，带背景颜色）
        var childBlocks: [[String: Any]] = []
        let chunkSize = NotionSyncConfig.maxTextLengthPrimary
        childBlocks.append(contentsOf: helperMethods.buildHighlightContinuationChildren(for: highlight, chunkSize: chunkSize))
        childBlocks.append(contentsOf: helperMethods.buildNoteChildren(for: highlight, chunkSize: chunkSize, source: source))

        // 使用 pageOperations.replacePageChildren 来替换指定 block 的 children（适用于 block 的 children endpoint）
        try await pageOperations.replacePageChildren(pageId: blockId, with: childBlocks)
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        // 预检：若单条内容过大，则直接写入占位条目
        if isTooLarge(highlight) {
            logger.warning("PerBook: content too large detected (pre-check), use placeholder. uuid=\(highlight.uuid)")
            return try await createPlaceholderItem(inDatabaseId: databaseId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
        }

        do {
            let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
            let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId, source: "appleBooks")

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
        } catch {
            // 兜底：若服务端校验仍认为内容过大，则降级为占位条目
            if NotionRequestHelper.isContentTooLargeError(error) {
                logger.warning("PerBook: content too large (HTTP), fallback to placeholder. uuid=\(highlight.uuid)")
                return try await createPlaceholderItem(inDatabaseId: databaseId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
            }
            throw error
        }
    }

    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        if isTooLarge(highlight) {
            logger.warning("PerBook: content too large detected (pre-check) on update, use placeholder. uuid=\(highlight.uuid)")
            try await updatePlaceholderItem(pageId: pageId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
            return
        }

        do {
            let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
            _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

            // Replace page children with up-to-date content
            let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId, source: "appleBooks")
            try await pageOperations.replacePageChildren(pageId: pageId, with: children)
        } catch {
            if NotionRequestHelper.isContentTooLargeError(error) {
                logger.warning("PerBook: content too large (HTTP) on update, fallback to placeholder. uuid=\(highlight.uuid)")
                try await updatePlaceholderItem(pageId: pageId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
                return
            }
            throw error
        }
    }

    // MARK: - Per-book Placeholder Helpers
    private func isTooLarge(_ h: HighlightRow) -> Bool {
        let limit = NotionSyncConfig.maxTextLengthPrimary
        if h.text.count > limit { return true }
        if let n = h.note, n.count > limit { return true }
        return false
    }

    private func makePlaceholderProperties(bookId: String, bookTitle: String, author: String, h: HighlightRow) -> [String: Any] {
        var props = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: h, clearEmpty: true)
        props["Text"] = ["title": [["text": ["content": NotionSyncConfig.placeholderTooLargeText]]]]
        props["Note"] = ["rich_text": []]
        return props
    }

    private func makePlaceholderChildren(h: HighlightRow, bookId: String) -> [[String: Any]] {
        return [ helperMethods.buildMetaAndLinkChild(for: h, bookId: bookId) ]
    }

    private func createPlaceholderItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        let properties = makePlaceholderProperties(bookId: bookId, bookTitle: bookTitle, author: author, h: highlight)
        let children = makePlaceholderChildren(h: highlight, bookId: bookId)
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

    private func updatePlaceholderItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        let properties = makePlaceholderProperties(bookId: bookId, bookTitle: bookTitle, author: author, h: highlight)
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])
        let children = makePlaceholderChildren(h: highlight, bookId: bookId)
        try await pageOperations.replacePageChildren(pageId: pageId, with: children)
    }
}
