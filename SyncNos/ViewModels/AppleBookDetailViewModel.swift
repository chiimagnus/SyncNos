import Foundation

@MainActor
class AppleBookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    var canLoadMore: Bool { expectedTotalCount > highlights.count }

    private let databaseService: DatabaseServiceProtocol
    private let syncService: AppleBooksSyncServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var session: DatabaseReadOnlySessionProtocol?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 50
    private var expectedTotalCount = 0

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         syncService: AppleBooksSyncServiceProtocol = DIContainer.shared.appleBooksSyncService) {
        self.databaseService = databaseService
        self.syncService = syncService
    }
    
    deinit {
        Task { @MainActor [weak self] in
            self?.closeSession()
        }
    }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) async {
        errorMessage = nil
        closeSession()
        highlights = []
        currentOffset = 0
        currentAssetId = assetId
        self.expectedTotalCount = expectedTotalCount

        if let path = dbPath {
            do {
                session = try databaseService.makeReadOnlySession(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        await loadNextPage(dbPath: dbPath, assetId: assetId)
    }
    
    func loadNextPage(dbPath: String?, assetId: String) async {
        if isLoadingPage { return }
        if highlights.count >= expectedTotalCount { return }

        if currentAssetId == nil {
            currentAssetId = assetId
        }
        if session == nil, let path = dbPath {
            do {
                session = try databaseService.makeReadOnlySession(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        guard let s = session, let asset = currentAssetId else { return }

        isLoadingPage = true

        do {
            let rows = try s.fetchHighlightPage(assetId: asset, limit: pageSize, offset: currentOffset, since: nil)
            let page = rows.map { r in
                Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
            }
            highlights.append(contentsOf: page)
            currentOffset += page.count
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoadingPage = false
    }
    
    private func closeSession() {
        session?.close()
        session = nil
    }

    // MARK: - Notion Sync
    // 统一入口：智能同步（创建/补齐/更新）
    func syncSmart(book: BookListItem, dbPath: String?) {
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true
        Task {
            do {
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "started"])                
                try await self.syncService.syncSmart(book: book, dbPath: dbPath) { progress in
                    Task { @MainActor in self.syncProgressText = progress }
                }
                await MainActor.run {
                    self.syncMessage = "同步完成"
                    self.syncProgressText = nil
                    self.isSyncing = false
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "succeeded"])                
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.syncProgressText = nil
                    self.isSyncing = false
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "failed"])                
                }
            }
        }
    }

    func syncToNotion(book: BookListItem, dbPath: String?, incremental: Bool = false) {
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true
        Task {
            do {
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "started"])                
                try await self.syncService.sync(book: book, dbPath: dbPath, incremental: incremental) { progress in
                    Task { @MainActor in self.syncProgressText = progress }
                }
                await MainActor.run {
                    self.syncMessage = incremental ? "增量同步完成" : "全量同步完成"
                    self.syncProgressText = nil
                    self.isSyncing = false
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "succeeded"])                
                }
            } catch {
                await MainActor.run {
                    self.syncMessage = error.localizedDescription
                    self.syncProgressText = nil
                    self.isSyncing = false
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "failed"])                
                }
            }
        }
    }
}
