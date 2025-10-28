import Foundation
import Combine

// Centralized notification names to avoid typos and improve maintainability
private enum ABNotifications {
    static let highlightSortChanged = Notification.Name("HighlightSortChanged")
    static let highlightFilterChanged = Notification.Name("HighlightFilterChanged")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
}

@MainActor
class AppleBooksDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    // Sorting and filtering state for highlights - field + direction, with UserDefaults persistence
    @Published var sortField: HighlightSortField = .created
    @Published var isAscending: Bool = false // 默认降序

    @Published var noteFilter: NoteFilter = false

    @Published var selectedStyles: Set<Int> = []

    var canLoadMore: Bool { expectedTotalCount > highlights.count }

    private let databaseService: DatabaseServiceProtocol
    private let syncService: AppleBooksSyncServiceProtocol
    private var session: DatabaseReadOnlySessionProtocol?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = NotionSyncConfig.appleBooksDetailPageSize
    private var expectedTotalCount = 0
    private var cancellables: Set<AnyCancellable> = []

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
        self.noteFilter = UserDefaults.standard.bool(forKey: "detail_note_filter")
        if let savedStyles = UserDefaults.standard.array(forKey: "detail_selected_styles") as? [Int] {
            self.selectedStyles = Set(savedStyles)
        }

        // Overlay with global highlight menu state when present (ensures menu and view stay in sync)
        if let globalSortRaw = UserDefaults.standard.string(forKey: "highlight_sort_field"),
           let globalSortField = HighlightSortField(rawValue: globalSortRaw) {
            self.sortField = globalSortField
        }
        self.isAscending = UserDefaults.standard.object(forKey: "highlight_sort_ascending") as? Bool ?? self.isAscending
        self.noteFilter = UserDefaults.standard.object(forKey: "highlight_has_notes") as? Bool ?? self.noteFilter
        if let globalStyles = UserDefaults.standard.array(forKey: "highlight_selected_styles") as? [Int] {
            self.selectedStyles = Set(globalStyles)
        }

        // Subscribe to global highlight sort changes from AppCommands
        NotificationCenter.default.publisher(for: ABNotifications.highlightSortChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = HighlightSortField(rawValue: keyRaw) {
                    self.sortField = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.isAscending = asc
                }
            }
            .store(in: &cancellables)

        // Subscribe to global highlight filter changes from AppCommands
        NotificationCenter.default.publisher(for: ABNotifications.highlightFilterChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let hasNotes = userInfo["hasNotes"] as? Bool {
                    self.noteFilter = hasNotes
                }
                // Future: handle color filters when menu supports it
            }
            .store(in: &cancellables)

        // Debounce frequent filter/sort toggles to avoid excessive reloads
        Publishers.CombineLatest4($sortField, $isAscending, $noteFilter, $selectedStyles)
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .removeDuplicates { lhs, rhs in
                // Manual dedupe for tuple with Set
                lhs.0 == rhs.0 && lhs.1 == rhs.1 && lhs.2 == rhs.2 && lhs.3 == rhs.3
            }
            .sink { [weak self] _ in
                guard let self else { return }
                if self.currentAssetId != nil {
                    Task { await self.loadFirstPage() }
                }
            }
            .store(in: &cancellables)

        // Debounced persistence of detail preferences to reduce UserDefaults I/O
        $sortField
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue.rawValue, forKey: "detail_sort_field")
                UserDefaults.standard.set(newValue.rawValue, forKey: "highlight_sort_field")
            }
            .store(in: &cancellables)

        $isAscending
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: "detail_sort_ascending")
                UserDefaults.standard.set(newValue, forKey: "highlight_sort_ascending")
            }
            .store(in: &cancellables)

        $noteFilter
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: "detail_note_filter")
                UserDefaults.standard.set(newValue, forKey: "highlight_has_notes")
            }
            .store(in: &cancellables)

        $selectedStyles
            .map { Array($0).sorted() }
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { arr in
                UserDefaults.standard.set(arr, forKey: "detail_selected_styles")
                UserDefaults.standard.set(arr, forKey: "highlight_selected_styles")
            }
            .store(in: &cancellables)
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

        // Capture state for background fetch to avoid main-actor blocking and race conditions
        let currentOffsetLocal = self.currentOffset
        let sortFieldLocal = self.sortField
        let isAscendingLocal = self.isAscending
        let noteFilterLocal = self.noteFilter
        let selectedStylesLocal = self.selectedStyles
        let pageSizeLocal = self.pageSize

        do {
            let stylesArray = selectedStylesLocal.isEmpty ? nil : Array(selectedStylesLocal)
            let rows = try await Task.detached(priority: .userInitiated) { () throws -> [HighlightRow] in
                try s.fetchHighlightPage(
                    assetId: asset,
                    limit: pageSizeLocal,
                    offset: currentOffsetLocal,
                    since: nil,
                    sortField: sortFieldLocal,
                    ascending: isAscendingLocal,
                    noteFilter: noteFilterLocal,
                    styles: stylesArray
                )
            }.value

            // If the current asset changed during the fetch, ignore these results
            guard asset == currentAssetId else {
                isLoadingPage = false
                return
            }

            let page = rows.map { r in
                Highlight(
                    uuid: r.uuid,
                    text: r.text,
                    note: r.note,
                    style: r.style,
                    dateAdded: r.dateAdded,
                    modified: r.modified,
                    location: r.location
                )
            }
            if reset {
                highlights = page
            } else {
                highlights.append(contentsOf: page)
            }
            currentOffset = currentOffsetLocal + page.count
            isLoadingPage = false
        } catch {
            errorMessage = error.localizedDescription
            isLoadingPage = false
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
