import Foundation

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
        self.pageOps = NotionPageOperations(requestHelper: requestHelper)
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

    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String> {
        return try await queryOps.collectExistingUUIDs(fromPageId: pageId)
    }

    func collectExistingUUIDToBlockIdMapping(fromPageId pageId: String) async throws -> [String: String] {
        return try await queryOps.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
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
        try await databaseOps.ensureDatabaseProperties(databaseId: databaseId, definitions: definitions)
    }

    func updatePageProperties(pageId: String, properties: [String: Any]) async throws {
        try await pageOps.updatePageProperties(pageId: pageId, properties: properties)
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        try await highlightOps.updateBlockContent(blockId: blockId, highlight: highlight, bookId: bookId)
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
}
