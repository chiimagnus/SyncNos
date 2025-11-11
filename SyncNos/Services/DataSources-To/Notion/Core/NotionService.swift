import Foundation

// 串行化按来源的 ensure（避免并发创建多个同名数据库）
private actor NotionSourceEnsureLock {
    private var waitersByKey: [String: [CheckedContinuation<Void, Never>]] = [:]

    func begin(key: String) async {
        if waitersByKey[key] != nil {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                waitersByKey[key]!.append(c)
            }
        } else {
            waitersByKey[key] = []
        }
    }

    func end(key: String) {
        let waiters = waitersByKey.removeValue(forKey: key) ?? []
        for w in waiters { w.resume() }
    }
}

final class NotionService: NotionServiceProtocol {
    // Core service components
    private let core: NotionServiceCore
    private let requestHelper: NotionRequestHelper
    private let helperMethods: NotionHelperMethods

    // Operation modules
    private let databaseOps: NotionDatabaseOperations
    private let pageOps: NotionPageOperations
    private let highlightOps: NotionHighlightOperations
    private let queryOps: NotionQueryOperations
    // 串行化 ensure（按来源）
    private static let sourceEnsureLock = NotionSourceEnsureLock()

    // Serialize property ensure per database to avoid racing PATCH on schema
    private actor NotionDBPropsEnsureLock {
        private var waitersByDb: [String: [CheckedContinuation<Void, Never>]] = [:]
        func begin(dbId: String) async {
            if waitersByDb[dbId] != nil {
                await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                    waitersByDb[dbId]!.append(c)
                }
            } else {
                waitersByDb[dbId] = []
            }
        }
        func end(dbId: String) {
            let waiters = waitersByDb.removeValue(forKey: dbId) ?? []
            for w in waiters { w.resume() }
        }
    }

    private static let dbPropsEnsureLock = NotionDBPropsEnsureLock()

    init(configStore: NotionConfigStoreProtocol) {
        // Initialize core components
        self.core = NotionServiceCore(configStore: configStore)
        self.requestHelper = NotionRequestHelper(
            configStore: configStore,
            apiBase: core.apiBase,
            notionVersion: core.notionVersion,
            logger: core.logger
        )
        self.helperMethods = NotionHelperMethods()

        // Initialize operation modules
        self.databaseOps = NotionDatabaseOperations(requestHelper: requestHelper)
        self.pageOps = NotionPageOperations(requestHelper: requestHelper, helperMethods: helperMethods)
        self.queryOps = NotionQueryOperations(requestHelper: requestHelper, logger: core.logger)
        self.highlightOps = NotionHighlightOperations(
            requestHelper: requestHelper,
            helperMethods: helperMethods,
            pageOperations: pageOps,
            logger: core.logger
        )
    }
    // Lightweight exists check by querying minimal page
    func databaseExists(databaseId: String) async -> Bool {
        await databaseOps.databaseExists(databaseId: databaseId)
    }

    func createDatabase(title: String) async throws -> NotionDatabase {
        guard let pageId = core.configStore.notionPageId else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        return try await databaseOps.createDatabase(title: title, pageId: pageId)
    }
    
    // MARK: - Extended helpers for sync
    func findDatabaseId(title: String, parentPageId: String) async throws -> String? {
        return try await databaseOps.findDatabaseId(title: title, parentPageId: parentPageId)
    }

    func findPageIdByAssetId(databaseId: String, assetId: String) async throws -> String? {
        return try await queryOps.findPageIdByAssetId(databaseId: databaseId, assetId: assetId)
    }

    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage {
        return try await pageOps.createBookPage(databaseId: databaseId, bookTitle: bookTitle, author: author, assetId: assetId, urlString: urlString, header: header)
    }

    /// Ensure a page exists in a database for the given asset; returns (pageId, created)
    func ensureBookPageInDatabase(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> (id: String, created: Bool) {
        if let existing = try await queryOps.findPageIdByAssetId(databaseId: databaseId, assetId: assetId) {
            return (existing, false)
        }
        let created = try await pageOps.createBookPage(databaseId: databaseId, bookTitle: bookTitle, author: author, assetId: assetId, urlString: urlString, header: header)
        return (created.id, true)
    }

    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String> {
        return try await queryOps.collectExistingUUIDs(fromPageId: pageId)
    }

    func collectExistingUUIDMapWithToken(fromPageId pageId: String) async throws -> [String: (blockId: String, token: String?)] {
        return try await queryOps.collectExistingUUIDMapWithToken(fromPageId: pageId)
    }

    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        try await highlightOps.appendHighlightBullets(pageId: pageId, bookId: bookId, highlights: highlights)
    }

    func appendBlocks(pageId: String, children: [[String: Any]]) async throws {
        try await pageOps.appendBlocks(pageId: pageId, children: children)
    }

    func updatePageHighlightCount(pageId: String, count: Int) async throws {
        try await pageOps.updatePageHighlightCount(pageId: pageId, count: count)
    }

    // MARK: - Generic property/schema helpers
    func ensureDatabaseProperties(databaseId: String, definitions: [String: Any]) async throws {
        // 串行化相同数据库的属性 ensure，避免并发 PATCH 造成意外覆盖
        await Self.dbPropsEnsureLock.begin(dbId: databaseId)
        defer { Task { await Self.dbPropsEnsureLock.end(dbId: databaseId) } }
        try await databaseOps.ensureDatabaseProperties(databaseId: databaseId, definitions: definitions)
    }

    func updatePageProperties(pageId: String, properties: [String: Any]) async throws {
        try await pageOps.updatePageProperties(pageId: pageId, properties: properties)
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String, source: String) async throws {
        try await highlightOps.updateBlockContent(blockId: blockId, highlight: highlight, bookId: bookId, source: source)
    }

    // MARK: - Per-book database (方案2)
    func createPerBookHighlightDatabase(bookTitle: String, author: String, assetId: String) async throws -> NotionDatabase {
        guard let pageId = core.configStore.notionPageId else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        return try await databaseOps.createPerBookHighlightDatabase(bookTitle: bookTitle, author: author, assetId: assetId, pageId: pageId)
    }
    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        return try await highlightOps.createHighlightItem(inDatabaseId: databaseId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
    }

    func findHighlightItemPageIdByUUID(databaseId: String, uuid: String) async throws -> String? {
        return try await queryOps.findHighlightItemPageIdByUUID(databaseId: databaseId, uuid: uuid)
    }

    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        try await highlightOps.updateHighlightItem(pageId: pageId, bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
    }

    /// Replace all page children with the provided blocks
    func setPageChildren(pageId: String, children: [[String: Any]]) async throws {
        try await pageOps.setPageChildren(pageId: pageId, children: children)
    }

    // Expose append so callers using the protocol can delegate to page operations
    func appendChildren(pageId: String, children: [[String: Any]], batchSize: Int) async throws {
        try await pageOps.appendChildren(pageId: pageId, children: children, batchSize: batchSize)
    }

    // MARK: - Ensure / find-or-create helpers (consolidated)
    /// Ensure a single (per-source) database exists: check config -> exists -> find by title -> create
    func ensureDatabaseIdForSource(title: String, parentPageId: String, sourceKey: String) async throws -> String {
        // 并发串行化，避免并发创建多个数据库
        await Self.sourceEnsureLock.begin(key: sourceKey)
        defer { Task { await Self.sourceEnsureLock.end(key: sourceKey) } }

        // 1) 双检：进入锁后再次检查与验证存在
        if let saved = core.configStore.databaseIdForSource(sourceKey) {
            if await databaseOps.databaseExists(databaseId: saved) { return saved }
            core.configStore.setDatabaseId(nil, forSource: sourceKey)
        }

        // 4) fallback to search-by-title (existing behavior)
        if let found = try await databaseOps.findDatabaseId(title: title, parentPageId: parentPageId) {
            core.configStore.setDatabaseId(found, forSource: sourceKey)
            return found
        }

        // 5) create new database as last resort
        let created = try await databaseOps.createDatabase(title: title, pageId: parentPageId)
        core.configStore.setDatabaseId(created.id, forSource: sourceKey)
        return created.id
    }

    /// Ensure a per-book database exists (used by per-book strategy). Returns (id, recreated)
    func ensurePerBookDatabase(bookTitle: String, author: String, assetId: String) async throws -> (id: String, recreated: Bool) {
        if let saved = core.configStore.databaseIdForBook(assetId: assetId) {
            if await databaseOps.databaseExists(databaseId: saved) { return (saved, false) }
            core.configStore.setDatabaseId(nil, forBook: assetId)
        }
        let db = try await databaseOps.createPerBookHighlightDatabase(bookTitle: bookTitle, author: author, assetId: assetId, pageId: core.configStore.notionPageId ?? "")
        core.configStore.setDatabaseId(db.id, forBook: assetId)
        return (db.id, true)
    }

    // MARK: - Discovery helpers
    /// 使用 /search 枚举当前 token 可访问的页面，过滤掉 parent 为 database_id 的条目（数据库条目页）
    /// 返回可作为数据库父级的页面摘要（workspace 顶级页与普通子页面）
    func listAccessibleParentPages(searchQuery: String?) async throws -> [NotionPageSummary] {
        struct SearchResponse: Decodable {
            struct Icon: Decodable { let type: String?; let emoji: String? }
            struct TitleFragment: Decodable { let plain_text: String? }
            struct Property: Decodable {
                let type: String?
                let title: [TitleFragment]?
            }
            struct Parent: Decodable { let type: String?; let page_id: String?; let database_id: String?; let workspace: Bool? }
            struct Result: Decodable {
                let object: String
                let id: String
                let icon: Icon?
                let parent: Parent?
                let properties: [String: Property]?
            }
            let results: [Result]
            let has_more: Bool?
            let next_cursor: String?
        }

        var collected: [NotionPageSummary] = []
        var cursor: String? = nil
        let pageSize = 100

        repeat {
            var body: [String: Any] = [
                "filter": ["property": "object", "value": "page"],
                "page_size": pageSize
            ]
            if let q = searchQuery, !q.isEmpty {
                body["query"] = q
            }
            if let c = cursor {
                body["start_cursor"] = c
            }
            let data = try await requestHelper.performRequest(path: "search", method: "POST", body: body)
            let decoded = try JSONDecoder().decode(SearchResponse.self, from: data)

            for r in decoded.results where r.object == "page" {
                // 过滤掉数据库条目（不能作为父级去创建数据库）
                if r.parent?.database_id != nil { continue }
                // 提取标题：寻找 properties 中第一个 type == "title" 的属性聚合 plain_text
                var title: String = ""
                if let props = r.properties {
                    if let titleProp = props.values.first(where: { $0.type == "title" }) {
                        title = (titleProp.title ?? []).compactMap { $0.plain_text }.joined()
                    }
                }
                if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    title = "Untitled"
                }
                let emoji = (r.icon?.type == "emoji") ? r.icon?.emoji : nil
                collected.append(NotionPageSummary(id: r.id, title: title, iconEmoji: emoji))
            }

            cursor = decoded.has_more == true ? decoded.next_cursor : nil
        } while cursor != nil

        return collected
    }
}
