import Foundation
import Combine

@MainActor
final class GoodLinksViewModel: ObservableObject {
    @Published var links: [GoodLinksLinkRow] = []
    @Published var highlightsByLinkId: [String: [GoodLinksHighlightRow]] = [:]
    @Published var contentByLinkId: [String: GoodLinksContentRow] = [:]
    @Published var isLoading: Bool = false
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
    }

    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        errorMessage = nil

        do {
            let dbPath = service.resolveDatabasePath()
            let rows = try service.fetchRecentLinks(dbPath: dbPath, limit: limit)
            links = rows
            logger.info("[GoodLinks] loaded links: \(rows.count)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
            errorMessage = desc
        }

        isLoading = false
    }

    // Derived collection for UI
    var displayLinks: [GoodLinksLinkRow] {
        var arr = links
        if showStarredOnly {
            arr = arr.filter { $0.starred }
        }
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let key = searchText.lowercased()
            arr = arr.filter { link in
                let inTitle = (link.title ?? "").lowercased().contains(key)
                let inAuthor = (link.author ?? "").lowercased().contains(key)
                let inURL = link.url.lowercased().contains(key)
                let inTags = link.tagsFormatted.lowercased().contains(key)
                return inTitle || inAuthor || inURL || inTags
            }
        }
        arr.sort { a, b in
            let cmp: ComparisonResult
            switch sortKey {
            case .title:
                let t1 = (a.title?.isEmpty == false ? a.title! : a.url)
                let t2 = (b.title?.isEmpty == false ? b.title! : b.url)
                cmp = t1.localizedCaseInsensitiveCompare(t2)
            case .highlightCount:
                let c1 = a.highlightTotal ?? 0
                let c2 = b.highlightTotal ?? 0
                cmp = c1 == c2 ? .orderedSame : (c1 < c2 ? .orderedAscending : .orderedDescending)
            case .added:
                cmp = a.addedAt == b.addedAt ? .orderedSame : (a.addedAt < b.addedAt ? .orderedAscending : .orderedDescending)
            case .modified:
                cmp = a.modifiedAt == b.modifiedAt ? .orderedSame : (a.modifiedAt < b.modifiedAt ? .orderedAscending : .orderedDescending)
            case .lastSync:
                // 使用 SyncTimestampStore 中记录的上次同步时间进行排序（若无记录则降序放在末尾/开头，取决于 sortAscending）
                let t1 = SyncTimestampStore.shared.getLastSyncTime(for: a.id)
                let t2 = SyncTimestampStore.shared.getLastSyncTime(for: b.id)
                if t1 == nil && t2 == nil {
                    cmp = .orderedSame
                } else if t1 == nil {
                    cmp = .orderedAscending
                } else if t2 == nil {
                    cmp = .orderedDescending
                } else {
                    cmp = t1! == t2! ? .orderedSame : (t1! < t2! ? .orderedAscending : .orderedDescending)
                }
            }
            return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
        }
        return arr
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
