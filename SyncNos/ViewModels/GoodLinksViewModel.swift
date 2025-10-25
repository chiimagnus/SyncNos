import Foundation
import Combine

@MainActor
final class GoodLinksViewModel: ObservableObject {
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
    @Published var sortKey: GoodLinksSortKey = .modified {
        didSet { UserDefaults.standard.set(sortKey.rawValue, forKey: "goodlinks_sort_key") }
    }
    @Published var sortAscending: Bool = false {
        didSet { UserDefaults.standard.set(sortAscending, forKey: "goodlinks_sort_ascending") }
    }
    @Published var showStarredOnly: Bool = false {
        didSet { UserDefaults.standard.set(showStarredOnly, forKey: "goodlinks_show_starred_only") }
    }
    @Published var searchText: String = "" {
        didSet { UserDefaults.standard.set(searchText, forKey: "goodlinks_search_text") }
    }

    private let service: GoodLinksDatabaseServiceExposed
    private let syncService: GoodLinksSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "GoodLinksViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
         syncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService(),
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.service = service
        self.syncService = syncService
        self.logger = logger
        subscribeSyncStatusNotifications()
        if let raw = UserDefaults.standard.string(forKey: "goodlinks_sort_key"), let k = GoodLinksSortKey(rawValue: raw) { self.sortKey = k }
        self.sortAscending = UserDefaults.standard.object(forKey: "goodlinks_sort_ascending") as? Bool ?? false
        self.showStarredOnly = UserDefaults.standard.object(forKey: "goodlinks_show_starred_only") as? Bool ?? false
        self.searchText = UserDefaults.standard.string(forKey: "goodlinks_search_text") ?? ""

        // 订阅来自 AppCommands 的过滤/排序变更通知
        NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFilterChanged"))
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

        // Combine 管道：在后台队列计算派生的 displayLinks，主线程发布结果
        let debouncedSearch = $searchText
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .removeDuplicates()

        Publishers.CombineLatest4($links, $sortKey, $sortAscending, $showStarredOnly)
            .combineLatest(debouncedSearch, recomputeTrigger.prepend(()))
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
                    searchText: searchText
                )
            }
            // 回到主线程发布结果，驱动 UI
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = false })
            .assign(to: &$displayLinks)
    }

    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        errorMessage = nil

        // 将同步 SQLite 读取移至后台线程，避免阻塞主线程
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async { [service, logger] in
                do {
                    let dbPath = service.resolveDatabasePath()
                    let rows = try service.fetchRecentLinks(dbPath: dbPath, limit: limit)
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { continuation.resume(); return }
                        self.links = rows
                        logger.info("[GoodLinks] loaded links: \(rows.count)")
                        self.isLoading = false
                        continuation.resume()
                    }
                } catch {
                    let desc = error.localizedDescription
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { continuation.resume(); return }
                        logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
                        self.errorMessage = desc
                        self.isLoading = false
                        continuation.resume()
                    }
                }
            }
        }
    }

    // 后台计算函数（纯函数，无 UI 依赖）
    private static func buildDisplayLinks(links: [GoodLinksLinkRow],
                                          sortKey: GoodLinksSortKey,
                                          sortAscending: Bool,
                                          showStarredOnly: Bool,
                                          searchText: String) -> [GoodLinksLinkRow] {
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
            lastSyncCache = Dictionary(uniqueKeysWithValues: arr.map { ($0.id, SyncTimestampStore.shared.getLastSyncTime(for: $0.id)) })
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

    func loadHighlights(for linkId: String, limit: Int = 500, offset: Int = 0) async {
        logger.info("[GoodLinks] 开始加载高亮，linkId=\(linkId)")

        do {
            let dbPath = service.resolveDatabasePath()
            logger.info("[GoodLinks] 数据库路径: \(dbPath)")
            let rows = try service.fetchHighlightsForLink(dbPath: dbPath, linkId: linkId, limit: limit, offset: offset)
            highlightsByLinkId[linkId] = rows
            logger.info("[GoodLinks] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadHighlights error: \(desc)")
            errorMessage = desc
        }
    }
    
    func loadContent(for linkId: String) async {
        logger.info("[GoodLinks] 开始加载全文内容，linkId=\(linkId)")

        do {
            let dbPath = service.resolveDatabasePath()
            if let content = try service.fetchContent(dbPath: dbPath, linkId: linkId) {
                contentByLinkId[linkId] = content
                logger.info("[GoodLinks] 加载到全文内容，linkId=\(linkId), wordCount=\(content.wordCount)")
            } else {
                logger.info("[GoodLinks] 该链接无全文内容，linkId=\(linkId)")
            }
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadContent error: \(desc)")
            errorMessage = desc
        }
    }

    // MARK: - Notion Sync (GoodLinks)
    /// 智能同步当前 GoodLinks 链接的高亮到 Notion（仅追加新条目，实际同步逻辑委托给 `GoodLinksSyncService`）
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = NotionSyncConfig.goodLinksPageSize) {
        if isSyncing { return }
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true

        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            // 发布开始通知
            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": link.id, "status": "started"])
            do {
                let dbPath = self.service.resolveDatabasePath()
                try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: pageSize) { [weak self] progressText in
                    Task { @MainActor in self?.syncProgressText = progressText }
                }
                await MainActor.run {
                    self.syncMessage = NSLocalizedString("同步完成", comment: "")
                    self.syncProgressText = nil
                    // 发布完成通知
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": link.id, "status": "succeeded"])
                }
            } catch {
                let desc = error.localizedDescription
                logger.error("[GoodLinks] syncSmart error: \(desc)")
                await MainActor.run {
                    self.errorMessage = desc
                    self.syncProgressText = nil
                    // 发布失败通知
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": link.id, "status": "failed"])
                }
            }
        }
    }

    private func subscribeSyncStatusNotifications() {
        NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .compactMap { info -> (String, String)? in
                guard let bookId = info["bookId"] as? String, let status = info["status"] as? String else { return nil }
                return (bookId, status)
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] (bookId, status) in
                guard let self else { return }
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
        let limiter = ConcurrencyLimiter(limit: max(1, concurrency))
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
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"])                        
                            do {
                                try await syncService.syncHighlights(for: link, dbPath: dbPath, pageSize: NotionSyncConfig.goodLinksPageSize) { progress in
                                    NotificationCenter.default.post(name: Notification.Name("SyncProgressUpdated"), object: nil, userInfo: ["bookId": id, "progress": progress])
                                }
                                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"])                        
                            } catch {
                                await MainActor.run { self.logger.error("[GoodLinks] batchSync error for id=\(id): \(error.localizedDescription)") }
                                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"])                        
                            }
                        }
                    }
                }
                await group.waitForAll()
            }
        }
    }
}
