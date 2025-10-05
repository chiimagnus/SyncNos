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
    private let syncService: GoodLinksSyncServiceProtocol
    private let logger: LoggerServiceProtocol

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         syncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService(),
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.service = service
        self.syncService = syncService
        self.logger = logger
    }

    func loadRecentLinks(limit: Int = 0) {
        isLoading = true
        errorMessage = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.service.resolveDatabasePath()
                let rows = try self.service.fetchRecentLinks(dbPath: dbPath, limit: limit)
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
                let dbPath = self.service.resolveDatabasePath()
                self.logger.info("[GoodLinks] 数据库路径: \(dbPath)")
                let rows = try self.service.fetchHighlightsForLink(dbPath: dbPath, linkId: linkId, limit: limit, offset: offset)
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
                let dbPath = self.service.resolveDatabasePath()
                if let content = try self.service.fetchContent(dbPath: dbPath, linkId: linkId) {
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

    // MARK: - Notion Sync (GoodLinks)
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，实际同步逻辑委托给 `GoodLinksSyncService`）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = 200) {
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
