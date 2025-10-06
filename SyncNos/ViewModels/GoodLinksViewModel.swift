import Foundation

@MainActor
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
    private let syncService: GoodLinksSyncServiceProtocol
    private let logger: LoggerServiceProtocol

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         syncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService(),
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.service = service
        self.syncService = syncService
        self.logger = logger
    }

    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        errorMessage = nil

        do {
            let dbPath = service.resolveDatabasePath()
            let rows = try service.fetchRecentLinks(dbPath: dbPath, limit: limit)
            links = rows
            logger.info("[GoodLinks] loaded links: \(rows.count)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
            errorMessage = desc
        }

        isLoading = false
    }

    func loadHighlights(for linkId: String, limit: Int = 500, offset: Int = 0) async {
        logger.info("[GoodLinks] 开始加载高亮，linkId=\(linkId)")

        do {
            let dbPath = service.resolveDatabasePath()
            logger.info("[GoodLinks] 数据库路径: \(dbPath)")
            let rows = try service.fetchHighlightsForLink(dbPath: dbPath, linkId: linkId, limit: limit, offset: offset)
            highlightsByLinkId[linkId] = rows
            logger.info("[GoodLinks] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadHighlights error: \(desc)")
            errorMessage = desc
        }
    }
    
    func loadContent(for linkId: String) async {
        logger.info("[GoodLinks] 开始加载全文内容，linkId=\(linkId)")

        do {
            let dbPath = service.resolveDatabasePath()
            if let content = try service.fetchContent(dbPath: dbPath, linkId: linkId) {
                contentByLinkId[linkId] = content
                logger.info("[GoodLinks] 加载到全文内容，linkId=\(linkId), wordCount=\(content.wordCount)")
            } else {
                logger.info("[GoodLinks] 该链接无全文内容，linkId=\(linkId)")
            }
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadContent error: \(desc)")
            errorMessage = desc
        }
    }

    // MARK: - Notion Sync (GoodLinks)
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，实际同步逻辑委托给 `GoodLinksSyncService`）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = NotionSyncConfig.goodLinksPageSize) {
        if isSyncing { return }
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true

        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            do {
                let dbPath = self.service.resolveDatabasePath()
                try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: pageSize) { [weak self] progressText in
                    Task { @MainActor in self?.syncProgressText = progressText }
                }
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

}
