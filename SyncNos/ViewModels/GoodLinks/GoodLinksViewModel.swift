import Foundation
import Combine

// Localized notification name definitions to avoid stringly-typed usage
private enum GLNotifications {
    static let goodLinksFilterChanged = Notification.Name("GoodLinksFilterChanged")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
    static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
}

// MARK: - GoodLinksViewModel (List)

/// GoodLinks 列表 ViewModel
/// 管理 links 列表的加载、排序、筛选、分页、批量同步
@MainActor
final class GoodLinksViewModel: ObservableObject {
    // MARK: - UserDefaults Keys
    
    private enum Keys {
        static let sortKey = "goodlinks_sort_key"
        static let sortAscending = "goodlinks_sort_ascending"
        static let showStarredOnly = "goodlinks_show_starred_only"
        static let searchText = "goodlinks_search_text"
    }
    
    // MARK: - Published Properties (List)
    
    @Published var links: [GoodLinksLinkRow] = []
    @Published var displayLinks: [GoodLinksLinkRow] = []
    @Published var visibleLinks: [GoodLinksLinkRow] = []
    
    @Published var isLoading: Bool = false
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?
    
    // MARK: - Sort & Filter Properties
    
    @Published var sortKey: GoodLinksSortKey = .modified
    @Published var sortAscending: Bool = false
    @Published var showStarredOnly: Bool = false
    @Published var searchText: String = ""
    
    // MARK: - Sync State
    
    @Published var syncingLinkIds: Set<String> = []
    @Published var syncedLinkIds: Set<String> = []
    
    // MARK: - Pagination
    
    private let pageSize: Int = 80
    private var currentPageSize: Int = 0
    
    // MARK: - Dependencies
    
    private let service: GoodLinksDatabaseServiceExposed
    private let syncService: GoodLinksSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "GoodLinksViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()
    
    // MARK: - Initialization
    
    init(
        service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        syncService: GoodLinksSyncServiceProtocol = DIContainer.shared.goodLinksSyncService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.service = service
        self.syncService = syncService
        self.logger = logger
        self.syncTimestampStore = syncTimestampStore
        self.notionConfig = notionConfig
        
        loadUserDefaults()
        setupNotificationSubscriptions()
        setupCombinePipelines()
        setupPersistenceSubscriptions()
    }
    
    // MARK: - Setup
    
    private func loadUserDefaults() {
        if let raw = UserDefaults.standard.string(forKey: Keys.sortKey), let k = GoodLinksSortKey(rawValue: raw) {
            self.sortKey = k
        }
        self.sortAscending = UserDefaults.standard.object(forKey: Keys.sortAscending) as? Bool ?? false
        self.showStarredOnly = UserDefaults.standard.object(forKey: Keys.showStarredOnly) as? Bool ?? false
        self.searchText = UserDefaults.standard.string(forKey: Keys.searchText) ?? ""
    }
    
    private func setupNotificationSubscriptions() {
        // 订阅同步状态通知
        NotificationCenter.default.publisher(for: GLNotifications.syncBookStatusChanged)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                // Ignore notifications emitted by AutoSyncService (object == nil)
                if notification.object == nil { return }
                if let sender = notification.object as? GoodLinksViewModel, sender === self {
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
    }
    
    private func setupCombinePipelines() {
        // Combine 管道：在后台队列计算派生的 displayLinks，主线程发布结果
        let debouncedSearch = $searchText
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .removeDuplicates()
        
        Publishers.CombineLatest4($links, $sortKey, $sortAscending, $showStarredOnly)
            .combineLatest(debouncedSearch, recomputeTrigger)
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
                    syncTimestampStore: self.syncTimestampStore
                )
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newDisplay in
                guard let self else { return }
                self.isComputingList = false
                self.displayLinks = newDisplay
                self.resetVisibleLinks()
            }
            .store(in: &cancellables)
    }
    
    private func setupPersistenceSubscriptions() {
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
    }
    
    // MARK: - Data Loading
    
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
    
    // MARK: - Display Links Computation
    
    private static func buildDisplayLinks(
        links: [GoodLinksLinkRow],
        sortKey: GoodLinksSortKey,
        sortAscending: Bool,
        showStarredOnly: Bool,
        searchText: String,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [GoodLinksLinkRow] {
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
                let inTags = link.tagsFormatted.lowercased().contains(key)
                return inTitle || inAuthor || inURL || inTags
            }
        }
        
        // 预取 lastSync 映射
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
    
    // MARK: - Pagination
    
    func triggerRecompute() {
        isComputingList = true
        recomputeTrigger.send(())
    }
    
    private func resetVisibleLinks() {
        currentPageSize = min(pageSize, displayLinks.count)
        if currentPageSize == 0 {
            visibleLinks = []
        } else {
            visibleLinks = Array(displayLinks.prefix(currentPageSize))
        }
    }
    
    func loadMoreIfNeeded(currentItem: GoodLinksLinkRow) {
        guard let index = visibleLinks.firstIndex(where: { $0.id == currentItem.id }) else { return }
        let threshold = max(visibleLinks.count - 10, 0)
        guard index >= threshold else { return }
        
        let newSize = min(currentPageSize + pageSize, displayLinks.count)
        guard newSize > currentPageSize else { return }
        
        currentPageSize = newSize
        visibleLinks = Array(displayLinks.prefix(currentPageSize))
    }
    
    // MARK: - Helpers
    
    func lastSync(for linkId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: linkId)
    }
    
    private func checkNotionConfig() -> Bool {
        notionConfig.isConfigured
    }
}

// MARK: - Batch Sync

extension GoodLinksViewModel {
    /// 批量同步所选 GoodLinks 到 Notion
    func batchSync(linkIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
        guard !linkIds.isEmpty else { return }
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        
        // 过滤掉已经在同步中的任务，防止重复触发
        let idsToSync = linkIds.subtracting(syncingLinkIds)
        guard !idsToSync.isEmpty else {
            logger.debug("[GoodLinks] All selected links are already syncing, skip")
            return
        }
        
        // 立即将任务标记为同步中，防止快捷键连续触发时重复入队
        // 注意：这必须在 Task 启动之前同步执行
        for id in idsToSync {
            syncingLinkIds.insert(id)
        }
        
        let dbPath = service.resolveDatabasePath()
        
        // 入队通知
        let items: [[String: Any]] = idsToSync.compactMap { id in
            guard let link = displayLinks.first(where: { $0.id == id }) else { return nil }
            let title = (link.title?.isEmpty == false ? link.title! : link.url)
            return ["id": id, "title": title, "subtitle": link.author ?? ""]
        }
        if !items.isEmpty {
            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": "goodLinks", "items": items])
        }
        
        let itemsById = Dictionary(uniqueKeysWithValues: links.map { ($0.id, $0) })
        let limiter = DIContainer.shared.syncConcurrencyLimiter
        let syncService = self.syncService
        let notionConfig = DIContainer.shared.notionConfigStore
        let notionService = DIContainer.shared.notionService
        
        Task {
            // 预先 resolve/ensure 一次 GoodLinks databaseId
            do {
                if let parentPageId = notionConfig.notionPageId {
                    if let persisted = notionConfig.databaseIdForSource("goodLinks") {
                        _ = await notionService.databaseExists(databaseId: persisted)
                    } else {
                        let id = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-GoodLinks", parentPageId: parentPageId, sourceKey: "goodLinks")
                        notionConfig.setDatabaseId(id, forSource: "goodLinks")
                    }
                }
            } catch {
                await MainActor.run { self.logger.error("[GoodLinks] pre-resolve databaseId failed: \(error.localizedDescription)") }
            }
            
            await withTaskGroup(of: Void.self) { group in
                for id in idsToSync {
                    guard let link = itemsById[id] else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return }
                        await limiter.withPermit {
                            // 发送开始通知（syncingLinkIds 已在外部同步设置）
                            await MainActor.run {
                                NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "started"])
                            }
                            do {
                                try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: NotionSyncConfig.goodLinksPageSize) { progress in
                                    Task { @MainActor in
                                        NotificationCenter.default.post(name: GLNotifications.syncProgressUpdated, object: self, userInfo: ["bookId": id, "progress": progress])
                                    }
                                }
                                await MainActor.run {
                                    _ = self.syncingLinkIds.remove(id)
                                    _ = self.syncedLinkIds.insert(id)
                                    NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "succeeded"])
                                }
                            } catch {
                                await MainActor.run {
                                    self.logger.error("[GoodLinks] batchSync error for id=\(id): \(error.localizedDescription)")
                                    _ = self.syncingLinkIds.remove(id)
                                    NotificationCenter.default.post(name: GLNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "failed"])
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
