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

    func syncHighlights(for link: GoodLinksLinkRow, dbPath: String, pageSize: Int = 200, progress: @escaping (String) -> Void) async throws {
        // 1) 校验 Notion 配置
        guard let parentPageId = notionConfig.notionPageId, notionConfig.notionKey?.isEmpty == false else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")])
        }

        // 2) 确保使用 GoodLinks 专属单库
        let databaseId = try await ensureGoodLinksDatabaseId(parentPageId: parentPageId)
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: Self.goodLinksPropertyDefinitions)

        // 3) 确保页面存在
        let pageId: String
        if let existing = try await notionService.findPageIdByPropertyEquals(databaseId: databaseId, propertyName: "Asset ID", value: link.id) {
            pageId = existing
        } else {
            let title = (link.title?.isEmpty == false ? link.title! : link.url)
            let properties: [String: Any] = [
                "Name": ["title": [["text": ["content": title]]]],
                "Asset ID": ["rich_text": [["text": ["content": link.id]]]],
                "Author": ["rich_text": [["text": ["content": link.author ?? ""]]]],
                "URL": ["url": link.url]
            ]
            let children: [[String: Any]] = [[
                "object": "block",
                "heading_2": ["rich_text": [["text": ["content": "Highlights"]]]]
            ]]
            let created = try await notionService.createPage(in: databaseId, properties: properties, children: children)
            pageId = created.id
        }

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

        // 4.3) 重建页面结构（Article + 内容 + Highlights header）
        var pageChildren: [[String: Any]] = []
        pageChildren.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Article"]]]
            ]
        ])
        if let contentText = contentRow?.content, !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let articleBlocks = Self.buildContentBlocks(from: contentText)
            pageChildren.append(contentsOf: articleBlocks)
        }
        pageChildren.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Highlights"]]]
            ]
        ])
        try await notionService.setPageChildren(pageId: pageId, children: pageChildren)

        // 5) 去重并追加
        let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
        let existingIds = Set(existingMap.keys)
        let toAppend = collected.filter { !existingIds.contains($0.id) }

        if !toAppend.isEmpty {
            progress(String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppend.count))
            try await Self.appendGoodLinksHighlights(notionService: notionService, pageId: pageId, link: link, highlights: toAppend)
        }

        // 6) 更新计数
        try await notionService.updatePageHighlightCount(pageId: pageId, count: collected.count)
    }

    // MARK: - Helpers moved from ViewModel
    private func ensureGoodLinksDatabaseId(parentPageId: String) async throws -> String {
        let desiredTitle = "SyncNos-GoodLinks"
        let sourceKey = "goodLinks"
        if let saved = notionConfig.databaseIdForSource(sourceKey) {
            if await notionService.databaseExists(databaseId: saved) { return saved }
            notionConfig.setDatabaseId(nil, forSource: sourceKey)
        }
        if let found = try await notionService.findDatabaseId(title: desiredTitle, parentPageId: parentPageId) {
            notionConfig.setDatabaseId(found, forSource: sourceKey)
            return found
        }
        let created = try await notionService.createDatabase(title: desiredTitle)
        notionConfig.setDatabaseId(created.id, forSource: sourceKey)
        return created.id
    }

    private static func appendGoodLinksHighlights(notionService: NotionServiceProtocol, pageId: String, link: GoodLinksLinkRow, highlights: [GoodLinksHighlightRow]) async throws {
        let batchSize = 80
        var index = 0
        while index < highlights.count {
            let slice = Array(highlights[index..<min(index + batchSize, highlights.count)])
            let children: [[String: Any]] = slice.map { h in
                var rt: [[String: Any]] = []
                rt.append(["text": ["content": h.content]])
                if let note = h.note, !note.isEmpty {
                    rt.append(["text": ["content": " — Note: \(note)"], "annotations": ["italic": true]])
                }
                if h.time > 0 {
                    let dateString = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: h.time))
                    rt.append(["text": ["content": " — added:\(dateString)"], "annotations": ["italic": true]])
                }
                rt.append(["text": ["content": "  Open ↗"], "href": link.url])
                rt.append(["text": ["content": " [uuid:\(h.id)]"], "annotations": ["code": true]])
                return [
                    "object": "block",
                    "bulleted_list_item": ["rich_text": rt]
                ]
            }
            try await notionService.appendBlocks(pageId: pageId, children: children)
            index += batchSize
        }
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

    private static func buildContentBlocks(from text: String) -> [[String: Any]] {
        let paragraphs = text.replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var children: [[String: Any]] = []
        let chunkSize = 1800
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
}


