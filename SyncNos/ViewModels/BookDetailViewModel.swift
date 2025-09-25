import Foundation
import SQLite3

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
    private let logger = DIContainer.shared.loggerService
    private var dbHandle: OpaquePointer?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 50
    private var expectedTotalCount = 0

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         syncCoordinator: NotionSyncCoordinatorProtocol = DIContainer.shared.syncCoordinator) {
        self.databaseService = databaseService
        self.syncCoordinator = syncCoordinator
    }
    
    deinit {
        closeHandle()
    }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) {
        errorMessage = nil
        closeHandle()
        highlights = []
        currentOffset = 0
        currentAssetId = assetId
        self.expectedTotalCount = expectedTotalCount
        
        if let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
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
        if dbHandle == nil, let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        guard let handle = dbHandle, let asset = currentAssetId else { return }
        
        isLoadingPage = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let rows = try self.databaseService.fetchHighlightPage(db: handle, assetId: asset, limit: self.pageSize, offset: self.currentOffset)
                let page = rows.map { r in
                    Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
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
    
    private func closeHandle() {
        if let handle = dbHandle {
            databaseService.close(handle)
            dbHandle = nil
        }
    }

    private func getLatestHighlightCount(dbPath: String?, assetId: String) async throws -> Int {
        guard let path = dbPath else { return 0 }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let count = counts.first { $0.assetId == assetId }?.count ?? 0
        logger.verbose("DEBUG: 获取到最新的高亮数量: \(count) for assetId: \(assetId)")
        return count
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

    // 已将方案1/方案2同步逻辑移至 NotionSyncCoordinator

    // MARK: - Helpers
    private func isDatabaseMissingError(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "NotionService" {
            return ns.code == 404 || ns.code == 400 || ns.code == 410
        }
        return false
    }
}
