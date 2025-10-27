import Foundation

@MainActor
class AppleBooksDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    // Sorting and filtering state for highlights - field + direction, with UserDefaults persistence
    @Published var sortField: HighlightSortField = .created {
        didSet {
            UserDefaults.standard.set(sortField.rawValue, forKey: "detail_sort_field")
            if currentAssetId != nil {
                Task { await loadFirstPage() }
            }
        }
    }
    @Published var isAscending: Bool = false { // 默认降序
        didSet {
            UserDefaults.standard.set(isAscending, forKey: "detail_sort_ascending")
            if currentAssetId != nil {
                Task { await loadFirstPage() }
            }
        }
    }

    @Published var noteFilter: NoteFilter = .any {
        didSet {
            UserDefaults.standard.set(noteFilter.rawValue, forKey: "detail_note_filter")
            // Reload data when note filter changes
            if currentAssetId != nil {
                Task {
                    await loadFirstPage()
                }
            }
        }
    }

    @Published var selectedStyles: Set<Int> = [] {
        didSet {
            UserDefaults.standard.set(Array(selectedStyles).sorted(), forKey: "detail_selected_styles")
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
    private var session: DatabaseReadOnlySessionProtocol?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = NotionSyncConfig.appleBooksDetailPageSize
    private var expectedTotalCount = 0

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         syncService: AppleBooksSyncServiceProtocol = DIContainer.shared.appleBooksSyncService) {
        self.databaseService = databaseService
        self.syncService = syncService

        // Load initial values from UserDefaults
        if let savedFieldRaw = UserDefaults.standard.string(forKey: "detail_sort_field"),
           let field = HighlightSortField(rawValue: savedFieldRaw) {
            self.sortField = field
        }
        self.isAscending = UserDefaults.standard.object(forKey: "detail_sort_ascending") as? Bool ?? false
        if let savedNoteFilterRaw = UserDefaults.standard.string(forKey: "detail_note_filter"),
           let filter = NoteFilter(rawValue: savedNoteFilterRaw) {
            self.noteFilter = filter
        }
        if let savedStyles = UserDefaults.standard.array(forKey: "detail_selected_styles") as? [Int] {
            self.selectedStyles = Set(savedStyles)
        }
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
            let rows = try s.fetchHighlightPage(assetId: asset, limit: pageSize, offset: currentOffset, since: nil, sortField: sortField, ascending: isAscending, noteFilter: noteFilter, styles: stylesArray)
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
}
