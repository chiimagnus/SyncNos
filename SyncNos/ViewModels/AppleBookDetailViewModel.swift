import Foundation

@MainActor
class AppleBookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    // Sorting and filtering state for highlights
    private var _order: HighlightOrder?
    private var _noteFilter: NoteFilter?
    private var _selectedStyles: Set<Int>?

    var order: HighlightOrder {
        get {
            if _order == nil {
                if let savedOrderRaw = UserDefaults.standard.string(forKey: "detail_sort_key"),
                   let order = HighlightOrder(rawValue: savedOrderRaw) {
                    _order = order
                } else {
                    _order = .createdDesc
                }
            }
            return _order!
        }
        set {
            _order = newValue
            UserDefaults.standard.set(newValue.rawValue, forKey: "detail_sort_key")
            // Reload data when order changes
            if currentAssetId != nil {
                Task {
                    await loadFirstPage()
                }
            }
        }
    }

    var noteFilter: NoteFilter {
        get {
            if _noteFilter == nil {
                if let savedNoteFilterRaw = UserDefaults.standard.string(forKey: "detail_note_filter"),
                   let filter = NoteFilter(rawValue: savedNoteFilterRaw) {
                    _noteFilter = filter
                } else {
                    _noteFilter = .any
                }
            }
            return _noteFilter!
        }
        set {
            _noteFilter = newValue
            UserDefaults.standard.set(newValue.rawValue, forKey: "detail_note_filter")
            // Reload data when note filter changes
            if currentAssetId != nil {
                Task {
                    await loadFirstPage()
                }
            }
        }
    }

    var selectedStyles: Set<Int> {
        get {
            if _selectedStyles == nil {
                if let savedStyles = UserDefaults.standard.array(forKey: "detail_selected_styles") as? [Int] {
                    _selectedStyles = Set(savedStyles)
                } else {
                    _selectedStyles = []
                }
            }
            return _selectedStyles!
        }
        set {
            _selectedStyles = newValue
            UserDefaults.standard.set(Array(newValue).sorted(), forKey: "detail_selected_styles")
            // Reload data when selected styles change
            if currentAssetId != nil {
                Task {
                    await loadFirstPage()
                }
            }
        }
    }

    var canLoadMore: Bool { expectedTotalCount > highlights.count }

    private let databaseService: DatabaseServiceProtocol
    private let syncService: AppleBooksSyncServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var session: DatabaseReadOnlySessionProtocol?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = NotionSyncConfig.appleBooksDetailPageSize
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
        await loadFirstPage()
    }

    private func loadFirstPage() async {
        if let assetId = currentAssetId {
            await loadNextPage(dbPath: nil, assetId: assetId, reset: true)
        }
    }
    
    func loadNextPage(dbPath: String?, assetId: String) async {
        await loadNextPage(dbPath: dbPath, assetId: assetId, reset: false)
    }

    private func loadNextPage(dbPath: String?, assetId: String, reset: Bool) async {
        if isLoadingPage { return }
        if !reset && highlights.count >= expectedTotalCount { return }

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

        if reset {
            highlights = []
            currentOffset = 0
        }

        isLoadingPage = true

        do {
            // Convert Set to Array for the API call
            let stylesArray = selectedStyles.isEmpty ? nil : Array(selectedStyles)
            let rows = try s.fetchHighlightPage(assetId: asset, limit: pageSize, offset: currentOffset, since: nil, order: order, noteFilter: noteFilter, styles: stylesArray)
            let page = rows.map { r in
                Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
            }
            if reset {
                highlights = page
            } else {
                highlights.append(contentsOf: page)
            }
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
