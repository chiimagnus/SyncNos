import Foundation

class BookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    var canLoadMore: Bool { expectedTotalCount > highlights.count }

    private let databaseService: DatabaseServiceProtocol
    private let syncCoordinator: NotionSyncCoordinatorProtocol
    private let epubContextService: EPUBContextServiceProtocol
    private let bookmarkStore: BookmarkStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private var session: DatabaseReadOnlySessionProtocol?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 50
    private var expectedTotalCount = 0

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         syncCoordinator: NotionSyncCoordinatorProtocol = DIContainer.shared.syncCoordinator,
         epubContextService: EPUBContextServiceProtocol = DIContainer.shared.epubContextService,
         bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore) {
        self.databaseService = databaseService
        self.syncCoordinator = syncCoordinator
        self.epubContextService = epubContextService
        self.bookmarkStore = bookmarkStore
    }
    
    deinit { closeSession() }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) {
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
        loadNextPage(dbPath: dbPath, assetId: assetId)
    }
    
    func loadNextPage(dbPath: String?, assetId: String) {
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
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                var rows = try s.fetchHighlightPage(assetId: asset, limit: self.pageSize, offset: self.currentOffset, since: nil)
                
                // Enrich highlights with EPUB context if iBooks directory is available
                if let iBooksURL = self.bookmarkStore.restoreiBooksDirectory() {
                    _ = self.bookmarkStore.startAccessingiBooksDirectory(url: iBooksURL)
                    self.logger.info("Enriching \(rows.count) highlights with EPUB context")
                    rows = self.epubContextService.enrichHighlights(rows, iBooksDirectoryURL: iBooksURL, progressHandler: nil)
                    self.bookmarkStore.stopAccessingiBooksDirectoryIfNeeded()
                } else {
                    self.logger.debug("iCloud Books directory not configured, skipping context enrichment")
                }
                
                let page = rows.map { r in
                    Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location, previousParagraph: r.previousParagraph, nextParagraph: r.nextParagraph)
                }
                DispatchQueue.main.async {
                    self.highlights.append(contentsOf: page)
                    self.currentOffset += page.count
                    self.isLoadingPage = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isLoadingPage = false
                }
            }
        }
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
                try await self.syncCoordinator.syncSmart(book: book, dbPath: dbPath) { progress in
                    Task { @MainActor in self.syncProgressText = progress }
                }
                await MainActor.run {
                    self.syncMessage = "同步完成"
                    self.syncProgressText = nil
                    self.isSyncing = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.syncProgressText = nil
                    self.isSyncing = false
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
                try await self.syncCoordinator.sync(book: book, dbPath: dbPath, incremental: incremental) { progress in
                    Task { @MainActor in self.syncProgressText = progress }
                }
                await MainActor.run {
                    self.syncMessage = incremental ? "增量同步完成" : "全量同步完成"
                    self.syncProgressText = nil
                    self.isSyncing = false
                }
            } catch {
                await MainActor.run {
                    self.syncMessage = error.localizedDescription
                    self.syncProgressText = nil
                    self.isSyncing = false
                }
            }
        }
    }
}
