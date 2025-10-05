import Foundation

final class GoodLinksViewModel: ObservableObject {
    @Published var links: [GoodLinksLinkRow] = []
    @Published var highlightsByLinkId: [String: [GoodLinksHighlightRow]] = [:]
    @Published var contentByLinkId: [String: GoodLinksContentRow] = [:]
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var isSyncing: Bool = false
    @Published var syncMessage: String?
    @Published var syncProgressText: String?

    private let service: GoodLinksDatabaseServiceExposed
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let logger = DIContainer.shared.loggerService

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.service = service
        self.notionService = notionService
        self.notionConfig = notionConfig
    }

    func loadRecentLinks(limit: Int = 0) {
        isLoading = true
        errorMessage = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.resolveDatabasePath()
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }
                let rows = try session.fetchRecentLinks(limit: limit)
                DispatchQueue.main.async {
                    self.links = rows
                    self.isLoading = false
                    self.logger.info("[GoodLinks] loaded links: \(rows.count)")
                }
            } catch {
                let desc = error.localizedDescription
                self.logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
                DispatchQueue.main.async {
                    self.errorMessage = desc
                    self.isLoading = false
                }
            }
        }
    }

    func loadHighlights(for linkId: String, limit: Int = 500, offset: Int = 0) {
        logger.info("[GoodLinks] 开始加载高亮，linkId=\(linkId)")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.resolveDatabasePath()
                self.logger.info("[GoodLinks] 数据库路径: \(dbPath)")
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }
                let rows = try session.fetchHighlightsForLink(linkId: linkId, limit: limit, offset: offset)
                self.logger.info("[GoodLinks] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
                DispatchQueue.main.async {
                    self.highlightsByLinkId[linkId] = rows
                    self.logger.info("[GoodLinks] 高亮数据已更新到UI，linkId=\(linkId), count=\(rows.count)")
                }
            } catch {
                let desc = error.localizedDescription
                self.logger.error("[GoodLinks] loadHighlights error: \(desc)")
                DispatchQueue.main.async {
                    self.errorMessage = desc
                }
            }
        }
    }
    
    func loadContent(for linkId: String) {
        logger.info("[GoodLinks] 开始加载全文内容，linkId=\(linkId)")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.resolveDatabasePath()
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }
                if let content = try session.fetchContent(linkId: linkId) {
                    self.logger.info("[GoodLinks] 加载到全文内容，linkId=\(linkId), wordCount=\(content.wordCount)")
                    DispatchQueue.main.async {
                        self.contentByLinkId[linkId] = content
                    }
                } else {
                    self.logger.info("[GoodLinks] 该链接无全文内容，linkId=\(linkId)")
                }
            } catch {
                let desc = error.localizedDescription
                self.logger.error("[GoodLinks] loadContent error: \(desc)")
            }
        }
    }

    // MARK: - Path Helpers
    private func resolveDatabasePath() -> String {
        // If user granted access to group container/Data, prefer it; otherwise fall back to default path
        if let url = GoodLinksBookmarkStore.shared.restore() {
            _ = GoodLinksBookmarkStore.shared.startAccessing(url: url)
            let path = url.path
            // Normalize to Data/data.sqlite
            let last = (path as NSString).lastPathComponent
            if last == "Data" {
                return (path as NSString).appendingPathComponent("data.sqlite")
            }
            if last.hasPrefix("group.com.ngocluu.goodlinks") || path.hasSuffix("/Group Containers/group.com.ngocluu.goodlinks") {
                return ((path as NSString).appendingPathComponent("Data") as NSString).appendingPathComponent("data.sqlite")
            }
            // If user picked a deeper path that already contains data.sqlite's directory
            let candidate = (path as NSString).appendingPathComponent("Data/data.sqlite")
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }
        // Fallback to the default known location
        return GoodLinksConnectionService().defaultDatabasePath()
    }

    // MARK: - Notion Sync (GoodLinks)
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，避免重复）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = 200) {
        if isSyncing { return }
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true

        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            do {
                // 1) 校验 Notion 配置
                guard let parentPageId = notionConfig.notionPageId, notionConfig.notionKey?.isEmpty == false else {
                    throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")])
                }

                // 2) 确保使用 GoodLinks 专属单库
                let databaseId = try await ensureGoodLinksDatabaseId(parentPageId: parentPageId)
                // 2.1) 确保库中存在 GoodLinks 所需属性（可重复调用，Notion 会做幂等添加）
                try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: Self.goodLinksPropertyDefinitions)

                // 3) 确保该链接对应的页面存在（以 link.id 作为 Asset ID）
                let pageId: String
                if let existing = try await notionService.findPageIdByAssetId(databaseId: databaseId, assetId: link.id) {
                    pageId = existing
                } else {
                    let created = try await notionService.createBookPage(
                        databaseId: databaseId,
                        bookTitle: (link.title?.isEmpty == false ? link.title! : link.url),
                        author: link.author ?? "",
                        assetId: link.id,
                        urlString: link.url,
                        header: "Highlights"
                    )
                    pageId = created.id
                }

                // 4) 读取 GoodLinks 高亮（分页）
                let dbPath = self.resolveDatabasePath()
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }

                var offset = 0
                var collected: [GoodLinksHighlightRow] = []
                var batch = 0
                while true {
                    let page = try session.fetchHighlightsForLink(linkId: link.id, limit: pageSize, offset: offset)
                    if page.isEmpty { break }
                    collected.append(contentsOf: page)
                    offset += pageSize
                    batch += 1
                    let countSnapshot = collected.count
                    await MainActor.run { self.syncProgressText = String(format: NSLocalizedString("Fetched %lld highlights...", comment: ""), countSnapshot) }
                }

                // 4.1) 读取 GoodLinks 正文内容/词数/视频时长
                let contentRow = try session.fetchContent(linkId: link.id)

                // 4.2) 更新页面属性（标签、摘要、添加/修改/阅读时间、是否收藏、原始URL、字数、视频时长、阅读分钟）
                var properties: [String: Any] = [:]
                // Tags -> multi_select
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

                // 4.3) 重建页面结构：## Article + 正文 + ## Highlights + 高亮列表（高亮列表后续 append）
                var pageChildren: [[String: Any]] = []
                // Article heading
                pageChildren.append([
                    "object": "block",
                    "heading_2": [
                        "rich_text": [["text": ["content": "Article"]]]
                    ]
                ])
                // Article paragraphs
                if let contentText = contentRow?.content, !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let articleBlocks = Self.buildContentBlocks(from: contentText)
                    pageChildren.append(contentsOf: articleBlocks)
                }
                // Highlights heading
                pageChildren.append([
                    "object": "block",
                    "heading_2": [
                        "rich_text": [["text": ["content": "Highlights"]]]
                    ]
                ])
                // 先替换为 Article + Highlights 头
                try await notionService.setPageChildren(pageId: pageId, children: pageChildren)

                // 5) 去重：读取 Notion 页面已有 UUID 映射，仅追加新高亮
                let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
                let existingIds = Set(existingMap.keys)
                let toAppend = collected.filter { !existingIds.contains($0.id) }

                if !toAppend.isEmpty {
                    await MainActor.run { self.syncProgressText = String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppend.count) }
                    try await appendGoodLinksHighlights(pageId: pageId, link: link, highlights: toAppend)
                }

                // 6)  更新计数（以全部数量为准）
                try await notionService.updatePageHighlightCount(pageId: pageId, count: collected.count)

                // 7) 结束
                await MainActor.run {
                    self.syncMessage = NSLocalizedString("同步完成", comment: "")
                    self.syncProgressText = nil
                }
            } catch {
                let desc = error.localizedDescription
                logger.error("[GoodLinks] syncSmart error: \(desc)")
                await MainActor.run {
                    self.errorMessage = desc
                    self.syncProgressText = nil
                }
            }
        }
    }

    // 确保（或创建）GoodLinks 专属单库：名称固定为 "SyncNos-GoodLinks"
    private func ensureGoodLinksDatabaseId(parentPageId: String) async throws -> String {
        let desiredTitle = "SyncNos-GoodLinks"
        // 优先使用 per-source 存储
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

    // 以 bulleted_list_item 形式追加高亮，包含 Note 与 [uuid:] 标记；链接使用 GoodLinks 的 URL
    private func appendGoodLinksHighlights(pageId: String, link: GoodLinksLinkRow, highlights: [GoodLinksHighlightRow]) async throws {
        // Notion API 建议批量大小 <= 100，这里与 Apple Books 逻辑一致取 80
        let batchSize = 80
        var index = 0
        while index < highlights.count {
            let slice = Array(highlights[index..<min(index + batchSize, highlights.count)])
            let children: [[String: Any]] = slice.map { h in
                var rt: [[String: Any]] = []
                // 内容
                rt.append(["text": ["content": h.content]])
                // 可选笔记
                if let note = h.note, !note.isEmpty {
                    rt.append(["text": ["content": " — Note: \(note)"], "annotations": ["italic": true]])
                }
                // 元数据（时间）
                if h.time > 0 {
                    let dateString = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: h.time))
                    rt.append(["text": ["content": " — added:\(dateString)"], "annotations": ["italic": true]])
                }
                // 原文链接（GoodLinks 的 URL）
                rt.append(["text": ["content": "  Open ↗"], "href": link.url])
                // UUID 标记用于幂等
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

    // MARK: - Helpers
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
        // 以双换行拆分段落，适度截断长段
        let paragraphs = text.replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var children: [[String: Any]] = []
        // Notion 建议单段富文本不能过长，这里按 1800 字符切块
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
