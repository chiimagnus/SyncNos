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
    private let logger = DIContainer.shared.loggerService

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         syncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService()) {
        self.service = service
        self.syncService = syncService
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
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，实际同步逻辑委托给 `GoodLinksSyncService`）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = 200) {
        if isSyncing { return }
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true

        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            do {
                let dbPath = self.resolveDatabasePath()
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
