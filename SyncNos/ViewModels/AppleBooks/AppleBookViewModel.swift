import Foundation
import Combine

// MARK: - AppleBookViewModel

@MainActor
class AppleBookViewModel: ObservableObject {
    @Published var books: [BookListItem] = []
    // 后台计算产物：用于列表渲染的派生结果
    @Published var displayBooks: [BookListItem] = []
    @Published var isLoading = false
    // 列表派生计算状态：用于切换瞬间显示"加载中"并避免主线程渲染巨大 List
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?
    // UI Sync State
    @Published var syncingBookIds: Set<String> = []
    @Published var syncedBookIds: Set<String> = []

    // Sorting and filtering state - Reactive properties with UserDefaults persistence
    @Published var sortKey: BookListSortKey = .title {
        didSet {
            UserDefaults.standard.set(sortKey.rawValue, forKey: "bookList_sort_key")
        }
    }

    @Published var sortAscending: Bool = true {
        didSet {
            UserDefaults.standard.set(sortAscending, forKey: "bookList_sort_ascending")
        }
    }

    @Published var showWithTitleOnly: Bool = false {
        didSet {
            UserDefaults.standard.set(showWithTitleOnly, forKey: "bookList_showWithTitleOnly")
        }
    }

    private let databaseService: DatabaseServiceProtocol
    private let appleBooksSyncService: AppleBooksSyncServiceProtocol
    private let bookmarkStore: BookmarkStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private var dbRootOverride: String?
    private var annotationDBPath: String?
    private var booksDBPath: String?
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "AppleBookViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()

    // Public readonly accessors
    var annotationDatabasePath: String? { annotationDBPath }
    var booksDatabasePath: String? { booksDBPath }

    // MARK: - Initialization
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore,
         syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
         appleBooksSyncService: AppleBooksSyncServiceProtocol = DIContainer.shared.appleBooksSyncService) {
        self.databaseService = databaseService
        self.bookmarkStore = bookmarkStore
        self.syncTimestampStore = syncTimestampStore
        self.appleBooksSyncService = appleBooksSyncService

        // Load initial values from UserDefaults
        if let savedSortKey = UserDefaults.standard.string(forKey: "bookList_sort_key"),
           let sortKey = BookListSortKey(rawValue: savedSortKey) {
            self.sortKey = sortKey
        }
        self.sortAscending = UserDefaults.standard.bool(forKey: "bookList_sort_ascending")
        self.showWithTitleOnly = UserDefaults.standard.bool(forKey: "bookList_showWithTitleOnly")
        
        // 订阅来自 AppCommands 的过滤/排序变更通知
        NotificationCenter.default.publisher(for: Notification.Name("AppleBooksFilterChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = BookListSortKey(rawValue: keyRaw) {
                    self.sortKey = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.sortAscending = asc
                }
                if let showTitleOnly = userInfo["showWithTitleOnly"] as? Bool {
                    self.showWithTitleOnly = showTitleOnly
                }
            }
            .store(in: &cancellables)

        subscribeSyncStatusNotifications()
        
        // Combine 管道：在后台队列计算派生的 displayBooks，主线程发布结果
        Publishers.CombineLatest4($books, $sortKey, $sortAscending, $showWithTitleOnly)
            .combineLatest(recomputeTrigger)
            // 主线程置计算标记为 true，确保第一帧显示"加载中"
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = true })
            // 在后台队列进行 filter/sort 等重计算
            .receive(on: computeQueue)
            .map { tuple -> [BookListItem] in
                let (combined, _) = tuple
                let (books, sortKey, sortAscending, showWithTitleOnly) = combined
                return Self.buildDisplayBooks(
                    books: books,
                    sortKey: sortKey,
                    sortAscending: sortAscending,
                    showWithTitleOnly: showWithTitleOnly,
                    syncTimestampStore: syncTimestampStore
                )
            }
            // 回到主线程发布结果，驱动 UI
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = false })
            .assign(to: &$displayBooks)
    }
    
    // MARK: - Path Utility Methods
    
    /// 根据选择的路径确定数据库根目录
    /// - Parameter selectedPath: 用户选择的路径
    /// - Returns: 数据库根目录路径
    func determineDatabaseRoot(from selectedPath: String) -> String {
        DatabasePathHelper.determineDatabaseRoot(from: selectedPath)
    }
    
    // MARK: - Public Methods
    
    /// 主动触发一次派生重算（供视图 onAppear/切换场景调用）
    func triggerRecompute() {
        recomputeTrigger.send(())
    }
    
    func setDbRootOverride(_ path: String?) {
        dbRootOverride = path
    }
    
    /// 恢复已保存的书签并申请访问权限，同时计算并设置数据库根目录
    /// - Returns: 是否成功开始访问安全作用域
    @discardableResult
    func restoreBookmarkAndConfigureRoot() -> Bool {
        guard let url = bookmarkStore.restore() else { return false }
        let started = bookmarkStore.startAccessing(url: url)
        logger.debug("Using restored bookmark on appear, startAccess=\(started)")
        let selectedPath = url.path
        let rootCandidate = determineDatabaseRoot(from: selectedPath)
        setDbRootOverride(rootCandidate)
        return started
    }
    
    /// 结束对当前安全作用域目录的访问
    func stopAccessingIfNeeded() {
        bookmarkStore.stopAccessingIfNeeded()
    }
    
    /// 供视图查询上次同步时间，避免视图直接依赖存储实现
    func lastSync(for bookId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: bookId)
    }
    
    func loadBooks() async {
        isLoading = true
        errorMessage = nil

        // 将同步 SQLite 读取与文件系统扫描移到后台，避免阻塞主线程
        // 先在主线程上捕获依赖与路径，避免跨 actor 访问
        let dbService = self.databaseService
        let logger = self.logger
        let root = self.dbRootOverride

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let result = try computeBooksFromDatabase(root: root, databaseService: dbService, logger: logger)
                    DispatchQueue.main.async {
                        self.books = result.books
                        self.annotationDBPath = result.annotationDB
                        self.booksDBPath = result.booksDB
                        logger.info("Successfully loaded \(result.books.count) books")
                        self.isLoading = false
                        continuation.resume()
                    }
                } catch {
                    let errorDesc = error.localizedDescription
                    DispatchQueue.main.async {
                        logger.error("Error loading books: \(errorDesc)")
                        self.errorMessage = errorDesc
                        self.isLoading = false
                        continuation.resume()
                    }
                }
            }
        }
    }
        
    // MARK: - Private Methods
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
                    self.syncingBookIds.insert(bookId)
                case "succeeded":
                    self.syncingBookIds.remove(bookId)
                    self.syncedBookIds.insert(bookId)
                case "failed":
                    self.syncingBookIds.remove(bookId)
                    // 保留已完成状态不变
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }
}

// MARK: - Nonisolated heavy computation helpers
/// 将 Apple Books 的磁盘扫描 + SQLite 聚合封装为无隔离纯函数，便于在后台线程执行
private func computeBooksFromDatabase(root: String?, databaseService: DatabaseServiceProtocol, logger: LoggerServiceProtocol) throws -> (books: [BookListItem], annotationDB: String, booksDB: String) {
    guard let root = root else {
        logger.warning("Books data root not selected; skipping load until user picks a folder")
        return ([], "", "")
    }
    logger.info("Books data root: \(root)")

    let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
    let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

    logger.debug("Looking for annotation DB in: \(annotationDir)")
    logger.debug("Looking for books DB in: \(booksDir)")

    guard let annotationDB = latestSQLiteFileStandalone(in: annotationDir, logger: logger) else {
        let error = "Annotation DB not found under \(annotationDir)"
        logger.error("Error: \(error)")
        throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
    }
    logger.info("Found annotation DB: \(annotationDB)")

    guard let booksDB = latestSQLiteFileStandalone(in: booksDir, logger: logger) else {
        let error = "Books DB not found under \(booksDir)"
        logger.error("Error: \(error)")
        throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
    }
    logger.info("Found books DB: \(booksDB)")

    // 使用只读会话封装连接生命周期
    let annotationSession = try databaseService.makeReadOnlySession(dbPath: annotationDB)
    defer { annotationSession.close(); logger.debug("Closed annotation DB session") }
    let booksSession = try databaseService.makeReadOnlySession(dbPath: booksDB)
    defer { booksSession.close(); logger.debug("Closed books DB session") }

    // 获取每本书的高亮统计信息（包括计数、创建时间、修改时间）
    let stats = try annotationSession.fetchHighlightStatsByAsset()
    let assetIds = stats.map { $0.assetId }.sorted()
    logger.info("Found \(assetIds.count) assets with highlights")

    // 获取书籍信息（标题/作者）
    let books = try booksSession.fetchBooks(assetIds: assetIds)
    logger.debug("Fetched \(books.count) books from library DB")

    // 创建书籍ID到书籍信息的映射
    var bookInfoMap: [String: BookRow] = [:]
    for book in books { bookInfoMap[book.assetId] = book }

    // 创建书籍列表
    var result: [BookListItem] = []
    result.reserveCapacity(stats.count)
    for stat in stats {
        let bookInfo = bookInfoMap[stat.assetId]
        let hasTitle = bookInfo != nil && !(bookInfo?.title ?? "").isEmpty
        let bookTitle = bookInfo?.title ?? ""
        let authorName = bookInfo?.author ?? ""
        result.append(BookListItem(
            bookId: stat.assetId,
            authorName: authorName,
            bookTitle: bookTitle,
            ibooksURL: "ibooks://assetid/\(stat.assetId)",
            highlightCount: stat.count,
            createdAt: stat.minCreationDate,
            modifiedAt: stat.maxModifiedDate,
            hasTitle: hasTitle
        ))
    }

    let sorted = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
    logger.info("Built list with \(sorted.count) books (with stats and metadata)")
    return (sorted, annotationDB, booksDB)
}

/// 独立的 SQLite 文件扫描，便于在后台线程使用
private func latestSQLiteFileStandalone(in dir: String, logger: LoggerServiceProtocol) -> String? {
    let url = URL(fileURLWithPath: dir)
    var isDir: ObjCBool = false
    if !FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) { return nil }
    if !isDir.boolValue { return nil }
    guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
    let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
    guard !sqliteFiles.isEmpty else { return nil }
    let sorted = sqliteFiles.sorted { a, b in
        (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast >
        (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast
    }
    return sorted.first?.path
}

/// 将排序和过滤逻辑封装为纯函数，便于在后台线程执行
private extension AppleBookViewModel {
    static func buildDisplayBooks(
        books: [BookListItem],
        sortKey: BookListSortKey,
        sortAscending: Bool,
        showWithTitleOnly: Bool,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [BookListItem] {
        var result = books
        
        // Apply title filter
        if showWithTitleOnly {
            result = result.filter { $0.hasTitle }
        }
        
        // 预取 lastSync 映射，避免比较器中频繁读取
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: result.map { ($0.bookId, syncTimestampStore.getLastSyncTime(for: $0.bookId)) })
        }
        
        // Apply sorting
        result.sort { book1, book2 in
            switch sortKey {
            case .title:
                let cmp = book1.bookTitle.localizedCaseInsensitiveCompare(book2.bookTitle)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            case .highlightCount:
                if book1.highlightCount == book2.highlightCount { return false }
                return sortAscending ? (book1.highlightCount < book2.highlightCount) : (book1.highlightCount > book2.highlightCount)
            case .lastSync:
                let time1 = lastSyncCache[book1.bookId] ?? nil
                let time2 = lastSyncCache[book2.bookId] ?? nil
                if time1 == nil && time2 == nil { return false }
                if time1 == nil { return sortAscending }
                if time2 == nil { return !sortAscending }
                if time1! == time2! { return false }
                return sortAscending ? (time1! < time2!) : (time1! > time2!)
            case .lastEdited:
                let time1 = book1.modifiedAt ?? Date.distantPast
                let time2 = book2.modifiedAt ?? Date.distantPast
                if time1 == time2 { return false }
                return sortAscending ? (time1 < time2) : (time1 > time2)
            case .created:
                let time1 = book1.createdAt ?? Date.distantPast
                let time2 = book2.createdAt ?? Date.distantPast
                if time1 == time2 { return false }
                return sortAscending ? (time1 < time2) : (time1 > time2)
            }
        }
        
        return result
    }
}

// MARK: - Batch Sync (Apple Books)
extension AppleBookViewModel {
    /// 批量同步所选书籍到 Notion，使用并发限流（默认 10 并发）
    func batchSync(bookIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
        guard !bookIds.isEmpty else { return }
        guard let dbPath = self.annotationDatabasePath else {
            logger.warning("[AppleBooks] annotationDatabasePath is nil; skip batchSync")
            return
        }

        let ids = Array(bookIds)
        let itemsById = Dictionary(uniqueKeysWithValues: books.map { ($0.bookId, $0) })
        let limiter = ConcurrencyLimiter(limit: max(1, concurrency))
        let syncService = self.appleBooksSyncService

        Task {
            // 在开始批量同步前，主线程标记这些 id 为正在同步，确保 UI 显示一致
            await MainActor.run {
                self.syncingBookIds.formUnion(bookIds)
            }

            await withTaskGroup(of: Void.self) { group in
                for id in ids {
                    guard let book = itemsById[id] else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return }
                        await limiter.withPermit {
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"])                        
                            do {
                                try await syncService.syncSmart(book: book, dbPath: dbPath) { progress in
                                    // 广播该书的同步进度，供详情页监听并显示
                                    NotificationCenter.default.post(name: Notification.Name("SyncProgressUpdated"), object: nil, userInfo: ["bookId": id, "progress": progress])
                                }
                                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"])                        
                            } catch {
                                await MainActor.run { self.logger.error("[AppleBooks] batchSync error for id=\(id): \(error.localizedDescription)") }
                                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"])                        
                            }

                            // 每个任务完成后，从主线程移除 syncing 标记
                            await MainActor.run {
                                self.syncingBookIds.remove(id)
                                if case .none = self.syncedBookIds.firstIndex(of: id) { }
                            }
                        }
                    }
                }
                await group.waitForAll()
            }
        }
    }
}