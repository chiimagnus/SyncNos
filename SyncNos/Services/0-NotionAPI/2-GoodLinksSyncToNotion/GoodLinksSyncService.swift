import Foundation

protocol GoodLinksSyncServiceProtocol: AnyObject {
    func syncHighlights(for link: GoodLinksLinkRow, dbPath: String, pageSize: Int, progress: @escaping (String) -> Void) async throws
}

final class GoodLinksSyncService: GoodLinksSyncServiceProtocol {
    private let databaseService: GoodLinksDatabaseServiceExposed
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol

    init(databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.logger = logger
    }

    func syncHighlights(for link: GoodLinksLinkRow, dbPath: String, pageSize: Int = NotionSyncConfig.goodLinksPageSize, progress: @escaping (String) -> Void) async throws {
        // 1) 校验 Notion 配置
        guard let parentPageId = notionConfig.notionPageId, notionConfig.notionKey?.isEmpty == false else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")])
        }

        // 2) 确保使用 GoodLinks 专属单库
        let databaseId = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-GoodLinks", parentPageId: parentPageId, sourceKey: "goodLinks")
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: Self.goodLinksPropertyDefinitions)

        // 3) 确保页面存在（统一 ensure API）
        let ensured = try await notionService.ensureBookPageInDatabase(
            databaseId: databaseId,
            bookTitle: (link.title?.isEmpty == false ? link.title! : link.url),
            author: link.author ?? "",
            assetId: link.id,
            urlString: link.url,
            header: "Highlights"
        )
        let pageId = ensured.id
        let created = ensured.created

        // 4) 读取高亮（分页）
        let session = try databaseService.makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }

        var offset = 0
        var collected: [GoodLinksHighlightRow] = []
        while true {
            let page = try session.fetchHighlightsForLink(linkId: link.id, limit: pageSize, offset: offset)
            if page.isEmpty { break }
            collected.append(contentsOf: page)
            offset += pageSize
            progress(String(format: NSLocalizedString("Fetched %lld highlights...", comment: ""), collected.count))
        }

        // 4.1) 读取正文
        let contentRow = try session.fetchContent(linkId: link.id)

        // 4.2) 更新页面属性
        var properties: [String: Any] = [:]
        if let tags = link.tags, !tags.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let tagNames = Self.parseTags(from: tags)
            if !tagNames.isEmpty {
                properties["Tags"] = [
                    "multi_select": tagNames.map { ["name": $0] }
                ]
            }
        }
        if let summary = link.summary, !summary.isEmpty {
            properties["Summary"] = ["rich_text": [["text": ["content": summary]]]]
        }
        properties["Starred"] = ["checkbox": link.starred]
        if link.addedAt > 0 {
            let start = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: link.addedAt))
            properties["Added At"] = ["date": ["start": start]]
        }
        if link.modifiedAt > 0 {
            let start = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: link.modifiedAt))
            properties["Modified At"] = ["date": ["start": start]]
        }
        if !properties.isEmpty {
            try await notionService.updatePageProperties(pageId: pageId, properties: properties)
        }

        // 4.3) 仅在首次创建页面时初始化结构（Article + 内容 + Highlights header）；避免在后续同步中重建导致删除旧内容
        if created {
            var pageChildren: [[String: Any]] = []
            pageChildren.append([
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": "Article"]]]
                ]
            ])
            if let contentText = contentRow?.content, !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let helper = NotionHelperMethods()
                let articleBlocks = helper.buildParagraphBlocks(from: contentText)
                pageChildren.append(contentsOf: articleBlocks)
            }
            pageChildren.append([
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": "Highlights"]]]
                ]
            ])
            try await notionService.setPageChildren(pageId: pageId, children: pageChildren)
        }

        // 5) 与 Apple Books 单库策略一致：构建增量更新/追加
        let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)

        var toUpdate: [(String, HighlightRow)] = []
        var toAppendHighlights: [HighlightRow] = []

        for h in collected {
            let addedDate = h.time > 0 ? Date(timeIntervalSince1970: h.time) : nil
            let fakeHighlight = HighlightRow(
                assetId: link.id,
                uuid: h.id,
                text: h.content,
                note: h.note,
                style: h.color,
                dateAdded: addedDate,
                modified: nil,
                location: nil
            )

            if let blockId = existingMap[h.id] {
                // GoodLinks 没有独立的 modified 字段，直接将现有条目加入更新队列以保持与 AppleBooks 的行为一致（但不基于 modified 做跳过判断）
                toUpdate.append((blockId, fakeHighlight))
            } else {
                toAppendHighlights.append(fakeHighlight)
            }
        }

        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for (blockId, h) in toUpdate {
                try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: link.id)
            }
        }

        if !toAppendHighlights.isEmpty {
            progress(String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppendHighlights.count))
            // 仍由 GoodLinks 自行构建 block，以确保颜色/元数据映射为 goodLinks
            let helper = NotionHelperMethods()
            var children: [[String: Any]] = []
            for h in toAppendHighlights {
                let block = helper.buildBulletedListItemBlock(for: h, bookId: link.url, maxTextLength: NotionSyncConfig.maxTextLengthPrimary, source: "goodLinks")
                children.append(block)
            }
            try await notionService.appendChildrenWithRetry(pageId: pageId, children: children, batchSize: NotionSyncConfig.defaultAppendBatchSize, trimOnFailureLengths: NotionSyncConfig.defaultTrimOnFailureLengths)
        }

        // 6) 更新计数并记录同步时间
        try await notionService.updatePageHighlightCount(pageId: pageId, count: collected.count)
        let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: link.id, to: t)
    }

    private static var goodLinksPropertyDefinitions: [String: Any] {
        return [
            "Tags": ["multi_select": [:]],
            "Summary": ["rich_text": [:]],
            "Starred": ["checkbox": [:]],
            "Added At": ["date": [:]],
            "Modified At": ["date": [:]]
        ]
    }

    private static func parseTags(from raw: String) -> [String] {
        GoodLinksTagParser.parseTagsString(raw)
    }

}
