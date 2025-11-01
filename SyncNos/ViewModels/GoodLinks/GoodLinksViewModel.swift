import Foundation
import Combine

// Localized notification name definitions to avoid stringly-typed usage
private enum GLNotifications {
    static let goodLinksFilterChanged = Notification.Name("GoodLinksFilterChanged")
    static let highlightSortChanged = Notification.Name("HighlightSortChanged")
    static let highlightFilterChanged = Notification.Name("HighlightFilterChanged")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
    static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
}

@MainActor
final class GoodLinksViewModel: ObservableObject {
    // Centralized UserDefaults keys
    private enum Keys {
        static let sortKey = "goodlinks_sort_key"
        static let sortAscending = "goodlinks_sort_ascending"
        static let showStarredOnly = "goodlinks_show_starred_only"
        static let searchText = "goodlinks_search_text"

        static let hlNoteFilter = "goodlinks_highlight_note_filter"
        static let hlSelectedStyles = "goodlinks_highlight_selected_styles"
        static let hlSortField = "goodlinks_highlight_sort_field"
        static let hlSortAscending = "goodlinks_highlight_sort_ascending"

        // Global highlight menu keys
        static let globalHasNotes = "highlight_has_notes"
        static let globalSelectedStyles = "highlight_selected_styles"
        static let globalSelectedMask = "highlight_selected_mask"
        static let globalSortField = "highlight_sort_field"
        static let globalSortAscending = "highlight_sort_ascending"
    }
    @Published var links: [GoodLinksLinkRow] = []
    // 后台计算产物：用于列表渲染的派生结果
    @Published var displayLinks: [GoodLinksLinkRow] = []
    @Published var highlightsByLinkId: [String: [GoodLinksHighlightRow]] = [:]
    @Published var contentByLinkId: [String: GoodLinksContentRow] = [:]
    @Published var isLoading: Bool = false
    // 列表派生计算状态：用于切换瞬间显示“加载中”并避免主线程渲染巨大 List
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?
    @Published var isSyncing: Bool = false
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    // UI Sync State per-link
    @Published var syncingLinkIds: Set<String> = []
    @Published var syncedLinkIds: Set<String> = []

    // Sorting & Filtering state (persisted)
    @Published var sortKey: GoodLinksSortKey = .modified
    @Published var sortAscending: Bool = false
    @Published var showStarredOnly: Bool = false
    @Published var searchText: String = ""

    // Highlight detail filtering & sorting state (for detail view)
    @Published var highlightNoteFilter: NoteFilter = false
    @Published var highlightSelectedStyles: Set<Int> = []
    @Published var highlightSortField: HighlightSortField = .created
    @Published var highlightIsAscending: Bool = false

    private let service: GoodLinksDatabaseServiceExposed
    private let syncService: GoodLinksSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "GoodLinksViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         syncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService(),
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
         syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore) {
        self.service = service
        self.syncService = syncService
        self.logger = logger
        self.syncTimestampStore = syncTimestampStore
        subscribeSyncStatusNotifications()
        if let raw = UserDefaults.standard.string(forKey: Keys.sortKey), let k = GoodLinksSortKey(rawValue: raw) { self.sortKey = k }
        self.sortAscending = UserDefaults.standard.object(forKey: Keys.sortAscending) as? Bool ?? false
        self.showStarredOnly = UserDefaults.standard.object(forKey: Keys.showStarredOnly) as? Bool ?? false
        self.searchText = UserDefaults.standard.string(forKey: Keys.searchText) ?? ""

        // Load highlight detail filter/sort settings (GoodLinks-specific defaults)
        self.highlightNoteFilter = UserDefaults.standard.bool(forKey: Keys.hlNoteFilter)
        if let savedStyles = UserDefaults.standard.array(forKey: Keys.hlSelectedStyles) as? [Int] {
            self.highlightSelectedStyles = Set(savedStyles)
        }
        if let savedSortFieldRaw = UserDefaults.standard.string(forKey: Keys.hlSortField),
           let sortField = HighlightSortField(rawValue: savedSortFieldRaw) {
            self.highlightSortField = sortField
        }
        self.highlightIsAscending = UserDefaults.standard.object(forKey: Keys.hlSortAscending) as? Bool ?? false

        // Overlay with global highlight menu state when present (ensures menu and view stay in sync)
        if let globalSortRaw = UserDefaults.standard.string(forKey: Keys.globalSortField),
           let globalSortField = HighlightSortField(rawValue: globalSortRaw) {
            self.highlightSortField = globalSortField
        }
        self.highlightIsAscending = UserDefaults.standard.object(forKey: Keys.globalSortAscending) as? Bool ?? self.highlightIsAscending
        self.highlightNoteFilter = UserDefaults.standard.object(forKey: Keys.globalHasNotes) as? Bool ?? self.highlightNoteFilter
        if let globalStyles = UserDefaults.standard.array(forKey: Keys.globalSelectedStyles) as? [Int] {
            self.highlightSelectedStyles = Set(globalStyles)
        }
        // Initialize mask to reflect current selection for App menu checkmarks
        do {
            let arr = Array(self.highlightSelectedStyles).sorted()
            if arr.isEmpty {
                UserDefaults.standard.set(0, forKey: Keys.globalSelectedMask)
            } else {
                var mask = 0
                for i in arr { mask |= (1 << i) }
                UserDefaults.standard.set(mask, forKey: Keys.globalSelectedMask)
            }
        }

        // 订阅来自 AppCommands 的过滤/排序变更通知
        NotificationCenter.default.publisher(for: GLNotifications.goodLinksFilterChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = GoodLinksSortKey(rawValue: keyRaw) {
                    self.sortKey = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.sortAscending = asc
                }
                if let starredOnly = userInfo["showStarredOnly"] as? Bool {
                    self.showStarredOnly = starredOnly
                }
            }
            .store(in: &cancellables)

        // Subscribe to global highlight sort changes from AppCommands
        NotificationCenter.default.publisher(for: GLNotifications.highlightSortChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = HighlightSortField(rawValue: keyRaw) {
                    self.highlightSortField = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.highlightIsAscending = asc
                }
            }
            .store(in: &cancellables)

        // Subscribe to global highlight filter changes from AppCommands
        NotificationCenter.default.publisher(for: GLNotifications.highlightFilterChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let hasNotes = userInfo["hasNotes"] as? Bool {
                    self.highlightNoteFilter = hasNotes
                }
                if let styles = userInfo["selectedStyles"] as? [Int] {
                    self.highlightSelectedStyles = Set(styles)
                }
            }
            .store(in: &cancellables)

        // Combine 管道：在后台队列计算派生的 displayLinks，主线程发布结果
        let debouncedSearch = $searchText
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .removeDuplicates()

        Publishers.CombineLatest4($links, $sortKey, $sortAscending, $showStarredOnly)
            .combineLatest(debouncedSearch, recomputeTrigger)
            // 主线程置计算标记为 true，确保第一帧显示“加载中”
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = true })
            // 在后台队列进行 filter/sort/tags 解析等重计算
            .receive(on: computeQueue)
            .map { tuple -> [GoodLinksLinkRow] in
                let (combined, searchText, _) = tuple
                let (links, sortKey, sortAscending, showStarredOnly) = combined
                return Self.buildDisplayLinks(
                    links: links,
                    sortKey: sortKey,
                    sortAscending: sortAscending,
                    showStarredOnly: showStarredOnly,
                    searchText: searchText,
                    syncTimestampStore: syncTimestampStore
                )
            }
            // 回到主线程发布结果，驱动 UI
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = false })
            .assign(to: &$displayLinks)

        // Debounced persistence for GoodLinks preferences
        $sortKey
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.sortKey)
            }
            .store(in: &cancellables)

        $sortAscending
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.sortAscending)
            }
            .store(in: &cancellables)

        $showStarredOnly
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.showStarredOnly)
            }
            .store(in: &cancellables)

        $searchText
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.searchText)
            }
            .store(in: &cancellables)

        $highlightNoteFilter
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.hlNoteFilter)
                UserDefaults.standard.set(newValue, forKey: Keys.globalHasNotes)
            }
            .store(in: &cancellables)

        $highlightSelectedStyles
            .map { Array($0).sorted() }
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { arr in
                UserDefaults.standard.set(arr, forKey: Keys.hlSelectedStyles)
                UserDefaults.standard.set(arr, forKey: Keys.globalSelectedStyles)
                // Maintain a compact mask for App menu binding
                if arr.isEmpty {
                    UserDefaults.standard.set(0, forKey: Keys.globalSelectedMask)
                } else {
                    var mask = 0
                    for i in arr { mask |= (1 << i) }
                    UserDefaults.standard.set(mask, forKey: Keys.globalSelectedMask)
                }
            }
            .store(in: &cancellables)

        $highlightSortField
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.hlSortField)
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.globalSortField)
            }
            .store(in: &cancellables)

        $highlightIsAscending
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.hlSortAscending)
                UserDefaults.standard.set(newValue, forKey: Keys.globalSortAscending)
            }
            .store(in: &cancellables)
    }

    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        errorMessage = nil

        let serviceForTask = service
        let loggerForTask = logger
        do {
            let (rows, _) = try await Task.detached(priority: .userInitiated) { () throws -> ([GoodLinksLinkRow], String) in
                let dbPath = serviceForTask.resolveDatabasePath()
                let rows = try serviceForTask.fetchRecentLinks(dbPath: dbPath, limit: limit)
                return (rows, dbPath)
            }.value
            await MainActor.run {
                self.links = rows
                loggerForTask.info("[GoodLinks] loaded links: \(rows.count)")
                self.isLoading = false
            }
        } catch {
            let desc = error.localizedDescription
            await MainActor.run {
                loggerForTask.error("[GoodLinks] loadRecentLinks error: \(desc)")
                self.errorMessage = desc
                self.isLoading = false
            }
        }
    }

    // 后台计算函数（纯函数，无 UI 依赖）
    private static func buildDisplayLinks(links: [GoodLinksLinkRow],
                                          sortKey: GoodLinksSortKey,
                                          sortAscending: Bool,
                                          showStarredOnly: Bool,
                                          searchText: String,
                                          syncTimestampStore: SyncTimestampStoreProtocol) -> [GoodLinksLinkRow] {
        var arr = links
        if showStarredOnly {
            arr = arr.filter { $0.starred }
        }
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let key = trimmed.lowercased()
            arr = arr.filter { link in
                let inTitle = (link.title ?? "").lowercased().contains(key)
                let inAuthor = (link.author ?? "").lowercased().contains(key)
                let inURL = link.url.lowercased().contains(key)
                // tagsFormatted 解析可能较重，放在后台队列中执行
                let inTags = link.tagsFormatted.lowercased().contains(key)
                return inTitle || inAuthor || inURL || inTags
            }
        }

        // 预取 lastSync 映射，避免比较器中频繁读取
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: arr.map { ($0.id, syncTimestampStore.getLastSyncTime(for: $0.id)) })
        }

        arr.sort { a, b in
            switch sortKey {
            case .title:
                let t1 = (a.title?.isEmpty == false ? a.title! : a.url)
                let t2 = (b.title?.isEmpty == false ? b.title! : b.url)
                let cmp = t1.localizedCaseInsensitiveCompare(t2)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            case .highlightCount:
                let c1 = a.highlightTotal ?? 0
                let c2 = b.highlightTotal ?? 0
                if c1 == c2 { return false }
                return sortAscending ? (c1 < c2) : (c1 > c2)
            case .added:
                if a.addedAt == b.addedAt { return false }
                return sortAscending ? (a.addedAt < b.addedAt) : (a.addedAt > b.addedAt)
            case .modified:
                if a.modifiedAt == b.modifiedAt { return false }
                return sortAscending ? (a.modifiedAt < b.modifiedAt) : (a.modifiedAt > b.modifiedAt)
            case .lastSync:
                let t1 = lastSyncCache[a.id] ?? nil
                let t2 = lastSyncCache[b.id] ?? nil
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return sortAscending }
                if t2 == nil { return !sortAscending }
                if t1! == t2! { return false }
                return sortAscending ? (t1! < t2!) : (t1! > t2!)
            }
        }
        return arr
    }

    // 主动触发一次派生重算（供视图 onAppear/切换场景调用）
    func triggerRecompute() {
        recomputeTrigger.send(())
    }

    /// 在切换到 GoodLinks 列表之前调用，确保首帧显示“加载中”并后台重算
    func prepareForDisplaySwitch() {
        // 先标记计算中，让视图首帧立即走占位分支
        isComputingList = true
    }

    func loadHighlights(for linkId: String, limit: Int = 500, offset: Int = 0) async {
        let serviceForTask = service
        let loggerForTask = logger
        do {
            let rows = try await Task.detached(priority: .userInitiated) { () throws -> [GoodLinksHighlightRow] in
                loggerForTask.info("[GoodLinks] 开始加载高亮，linkId=\(linkId)")
                let dbPath = serviceForTask.resolveDatabasePath()
                loggerForTask.info("[GoodLinks] 数据库路径: \(dbPath)")
                return try serviceForTask.fetchHighlightsForLink(dbPath: dbPath, linkId: linkId, limit: limit, offset: offset)
            }.value
            await MainActor.run {
                self.highlightsByLinkId[linkId] = rows
                loggerForTask.info("[GoodLinks] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
            }
        } catch {
            let desc = error.localizedDescription
            await MainActor.run {
                loggerForTask.error("[GoodLinks] loadHighlights error: \(desc)")
                self.errorMessage = desc
            }
        }
    }
    
    func loadContent(for linkId: String) async {
        let serviceForTask = service
        let loggerForTask = logger
        do {
            let content = try await Task.detached(priority: .userInitiated) { () throws -> GoodLinksContentRow? in
                loggerForTask.info("[GoodLinks] 开始加载全文内容，linkId=\(linkId)")
                let dbPath = serviceForTask.resolveDatabasePath()
                return try serviceForTask.fetchContent(dbPath: dbPath, linkId: linkId)
            }.value
            await MainActor.run {
                if let content {
                    self.contentByLinkId[linkId] = content
                    loggerForTask.info("[GoodLinks] 加载到全文内容，linkId=\(linkId), wordCount=\(content.wordCount)")
                } else {
                    loggerForTask.info("[GoodLinks] 该链接无全文内容，linkId=\(linkId)")
                }
            }
        } catch {
            let desc = error.localizedDescription
            await MainActor.run {
                loggerForTask.error("[GoodLinks] loadContent error: \(desc)")
                self.errorMessage = desc
            }
        }
    }

    // 供视图层查询上次同步时间，避免直接访问单例
    func lastSync(for linkId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: linkId)
    }

    // MARK: - Notion Sync (GoodLinks)
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，实际同步逻辑委托给 `GoodLinksSyncService`）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = NotionSyncConfig.goodLinksPageSize) {
        if isSyncing { return }
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true
        // Mark UI state for this link immediately
        syncingLinkIds.insert(link.id)

        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            let limiter = DIContainer.shared.syncConcurrencyLimiter
            await limiter.withPermit {
                // 发布开始通知（获得许可后）
                NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": link.id, "status": "started"])
                do {
                    let dbPath = self.service.resolveDatabasePath()
                    try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: pageSize) { [weak self] progressText in
                        Task { @MainActor in self?.syncProgressText = progressText }
                    }
                    await MainActor.run {
                        self.syncMessage = NSLocalizedString("同步完成", comment: "")
                        self.syncProgressText = nil
                        // 发布完成通知
                        NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": link.id, "status": "succeeded"])
                        // Update UI state directly
                        self.syncingLinkIds.remove(link.id)
                        self.syncedLinkIds.insert(link.id)
                    }
                } catch {
                    let desc = error.localizedDescription
                    logger.error("[GoodLinks] syncSmart error: \(desc)")
                    await MainActor.run {
                        self.errorMessage = desc
                        self.syncProgressText = nil
                        // 发布失败通知
                        NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": link.id, "status": "failed"])
                        // Update UI state directly
                        self.syncingLinkIds.remove(link.id)
                    }
                }
            }
        }
    }

    private func subscribeSyncStatusNotifications() {
        NotificationCenter.default.publisher(for: GLNotifications.syncBookStatusChanged)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                if let sender = notification.object as? GoodLinksViewModel, sender === self {
                    // Ignore self-emitted to prevent duplicate UI state
                    return
                }
                guard let info = notification.userInfo as? [String: Any],
                      let bookId = info["bookId"] as? String,
                      let status = info["status"] as? String else { return }
                switch status {
                case "started":
                    self.syncingLinkIds.insert(bookId)
                case "succeeded":
                    self.syncingLinkIds.remove(bookId)
                    self.syncedLinkIds.insert(bookId)
                case "failed":
                    self.syncingLinkIds.remove(bookId)
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }
}

// MARK: - Batch Sync (GoodLinks)
extension GoodLinksViewModel {
    /// 批量同步所选 GoodLinks 到 Notion，使用并发限流（默认 10 并发）
    func batchSync(linkIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
        guard !linkIds.isEmpty else { return }
        let dbPath = service.resolveDatabasePath()
        let itemsById = Dictionary(uniqueKeysWithValues: links.map { ($0.id, $0) })
        let limiter = DIContainer.shared.syncConcurrencyLimiter
        let syncService = self.syncService
        let notionConfig = DIContainer.shared.notionConfigStore
        let notionService = DIContainer.shared.notionService

        Task {
            // 预先 resolve/ensure 一次 GoodLinks databaseId，避免首次并发创建多个数据库
            do {
                if let parentPageId = notionConfig.notionPageId {
                    if let persisted = notionConfig.databaseIdForSource("goodLinks") {
                        _ = await notionService.databaseExists(databaseId: persisted) // 仅验证，不清理
                    } else {
                        let id = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-GoodLinks", parentPageId: parentPageId, sourceKey: "goodLinks")
                        notionConfig.setDatabaseId(id, forSource: "goodLinks")
                    }
                }
            } catch {
                await MainActor.run { self.logger.error("[GoodLinks] pre-resolve databaseId failed: \(error.localizedDescription)") }
            }
            await withTaskGroup(of: Void.self) { group in
                for id in linkIds {
                    guard let link = itemsById[id] else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return }
                        await limiter.withPermit {
                            // Update local UI state and post started
                            await MainActor.run { _ = self.syncingLinkIds.insert(id) }
                            NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "started"])                        
                            do {
                                try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: NotionSyncConfig.goodLinksPageSize) { progress in
                                    NotificationCenter.default.post(name: GLNotifications.syncProgressUpdated, object: self, userInfo: ["bookId": id, "progress": progress])
                                }
                                NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "succeeded"])                        
                                await MainActor.run {
                                    _ = self.syncingLinkIds.remove(id)
                                    _ = self.syncedLinkIds.insert(id)
                                }
                            } catch {
                                await MainActor.run { self.logger.error("[GoodLinks] batchSync error for id=\(id): \(error.localizedDescription)") }
                                NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "failed"])                        
                                await MainActor.run {
                                    _ = self.syncingLinkIds.remove(id)
                                }
                            }
                        }
                    }
                }
                await group.waitForAll()
            }
        }
    }
}

// MARK: - Highlight Detail Filtering & Sorting
extension GoodLinksViewModel {
    /// Get filtered and sorted highlights for a specific link
    func getFilteredHighlights(for linkId: String) -> [GoodLinksHighlightRow] {
        guard let sourceHighlights = highlightsByLinkId[linkId] else { return [] }

        var filtered = sourceHighlights

        // Apply note filter
        if highlightNoteFilter {
            filtered = filtered.filter { $0.note != nil && !$0.note!.isEmpty }
        }

        // Apply color filter
        if !highlightSelectedStyles.isEmpty {
            filtered = filtered.filter { highlight in
                guard let color = highlight.color else { return false }
                return highlightSelectedStyles.contains(color)
            }
        }

        // Apply sorting (GoodLinks only has 'time' field, so created/modified use the same logic)
        filtered = filtered.sorted { lhs, rhs in
            switch highlightSortField {
            case .created:
                if highlightIsAscending {
                    return lhs.time < rhs.time
                } else {
                    return lhs.time > rhs.time
                }
            case .modified:
                if highlightIsAscending {
                    return lhs.time < rhs.time
                } else {
                    return lhs.time > rhs.time
                }
            }
        }

        return filtered
    }

    /// Reset highlight filters to default
    func resetHighlightFilters() {
        highlightNoteFilter = false
        highlightSelectedStyles = []
    }
}
