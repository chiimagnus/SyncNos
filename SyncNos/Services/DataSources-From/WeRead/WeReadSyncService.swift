import Foundation

/// WeRead -> Notion 同步服务实现
final class WeReadSyncService: WeReadSyncServiceProtocol {
    private let apiService: WeReadAPIServiceProtocol
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol

    init(
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.apiService = apiService
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.logger = logger
    }

    func syncHighlights(for book: WeReadBookListItem, progress: @escaping (String) -> Void) async throws {
        // 1) 校验 Notion 配置（支持 OAuth token 或 API key）
        guard let parentPageId = notionConfig.notionPageId else {
            throw NSError(
                domain: "WeReadSync",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")]
            )
        }
        guard let token = notionConfig.effectiveToken, !token.isEmpty else {
            throw NSError(
                domain: "WeReadSync",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please authorize Notion first.", comment: "")]
            )
        }
        _ = token // 仅用于校验，实际请求封装在 NotionService 内部

        // 2) 解析 WeRead 单库：优先使用已持久化的 ID；仅当明确不存在时才清理并创建
        let databaseId: String
        if let persisted = notionConfig.databaseIdForSource("weRead") {
            if await notionService.databaseExists(databaseId: persisted) {
                databaseId = persisted
            } else {
                notionConfig.setDatabaseId(nil, forSource: "weRead")
                databaseId = try await notionService.ensureDatabaseIdForSource(
                    title: "SyncNos-WeRead",
                    parentPageId: parentPageId,
                    sourceKey: "weRead"
                )
            }
        } else {
            databaseId = try await notionService.ensureDatabaseIdForSource(
                title: "SyncNos-WeRead",
                parentPageId: parentPageId,
                sourceKey: "weRead"
            )
        }
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: Self.weReadPropertyDefinitions)

        // 3) 确保页面存在（统一 ensure API）
        let ensured = try await notionService.ensureBookPageInDatabase(
            databaseId: databaseId,
            bookTitle: book.title,
            author: book.author,
            assetId: book.bookId,
            urlString: nil,
            header: nil
        )
        let pageId = ensured.id

        // 4) 从 WeRead API 拉取最新高亮与想法，直接转换为 HighlightRow
        progress(NSLocalizedString("Fetching WeRead highlights...", comment: ""))
        let bookmarks = try await apiService.fetchBookmarks(bookId: book.bookId)
        let reviews = try await apiService.fetchReviews(bookId: book.bookId)

        guard !bookmarks.isEmpty || !reviews.isEmpty else {
            progress(NSLocalizedString("No highlights to sync.", comment: ""))
            return
        }

        let helper = NotionHelperMethods()
        var rows: [HighlightRow] = []
        rows.reserveCapacity(bookmarks.count + reviews.count)
        
        // 转换 bookmarks
        for bm in bookmarks {
            let row = HighlightRow(
                assetId: book.bookId,
                uuid: bm.highlightId,
                text: bm.text,
                note: bm.note,
                style: bm.colorIndex,
                dateAdded: bm.timestamp.map { Date(timeIntervalSince1970: $0) },
                modified: nil,
                location: bm.chapterTitle
            )
            rows.append(row)
        }
        
        // 转换 reviews（作为带 note 的虚拟高亮）
        for rv in reviews {
            let row = HighlightRow(
                assetId: book.bookId,
                uuid: "review-\(rv.reviewId)",
                text: rv.content,
                note: rv.content,
                style: nil,
                dateAdded: rv.timestamp.map { Date(timeIntervalSince1970: $0) },
                modified: nil,
                location: nil
            )
            rows.append(row)
        }

        // 6) 读取现有高亮 token，按需更新或追加
        let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)

        var toUpdate: [(String, HighlightRow)] = []
        var toAppend: [HighlightRow] = []
        for r in rows {
            if let existing = existingMapWithToken[r.uuid] {
                let localToken = helper.computeModifiedToken(for: r, source: "weRead")
                if let remoteToken = existing.token, remoteToken == localToken {
                    continue
                } else {
                    toUpdate.append((existing.blockId, r))
                }
            } else {
                toAppend.append(r)
            }
        }

        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for (blockId, r) in toUpdate {
                try await notionService.updateBlockContent(blockId: blockId, highlight: r, bookId: book.bookId, source: "weRead")
            }
        }

        if !toAppend.isEmpty {
            progress(String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppend.count))
            var children: [[String: Any]] = []
            for r in toAppend {
                let block = helper.buildBulletedListItemBlock(
                    for: r,
                    bookId: book.bookId,
                    maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                    source: "weRead"
                )
                children.append(block)
            }
            try await notionService.appendChildren(
                pageId: pageId,
                children: children,
                batchSize: NotionSyncConfig.defaultAppendBatchSize
            )
        }

        // 7) 更新计数与同步时间
        try await notionService.updatePageHighlightCount(pageId: pageId, count: rows.count)
        let nowString = NotionServiceCore.systemTimeZoneIsoDateFormatter.string(from: Date())
        try await notionService.updatePageProperties(pageId: pageId, properties: [
            "Last Sync Time": ["date": ["start": nowString]]
        ])
        SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: Date())
    }

    // MARK: - Notion 属性定义

    private static var weReadPropertyDefinitions: [String: Any] {
        return [
            "Author": ["rich_text": [:]],
            "WeRead Book ID": ["rich_text": [:]],
            "Category": ["rich_text": [:]],
            "Last Sync Time": ["date": [:]]
        ]
    }
}
