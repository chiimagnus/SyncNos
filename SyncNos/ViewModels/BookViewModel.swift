import Foundation
import Combine

// MARK: - BookViewModel

@MainActor
class BookViewModel: ObservableObject {
    @Published var books: [BookListItem] = []
    @Published var isLoading = false
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

    // Computed property to maintain backward compatibility with existing code that uses the old sort property
    var sort: BookListSort {
        get {
            return BookListSort(key: sortKey, ascending: sortAscending)
        }
        set {
            sortKey = newValue.key
            sortAscending = newValue.ascending
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

    // Public readonly accessors
    var annotationDatabasePath: String? { annotationDBPath }
    var booksDatabasePath: String? { booksDBPath }

    // Computed property for displaying books based on sort and filter
    var displayBooks: [BookListItem] {
        get {
            var result = books

            // Apply title filter
            if showWithTitleOnly {
                result = result.filter { $0.hasTitle }
            }

            // Apply sorting
            result.sort { book1, book2 in
                var result: ComparisonResult
                switch sortKey {
                case .title:
                    result = book1.bookTitle.localizedCaseInsensitiveCompare(book2.bookTitle)
                case .highlightCount:
                    result = book1.highlightCount < book2.highlightCount ? .orderedAscending : .orderedDescending
                case .lastSync:
                    let time1 = syncTimestampStore.getLastSyncTime(for: book1.bookId) ?? Date.distantPast
                    let time2 = syncTimestampStore.getLastSyncTime(for: book2.bookId) ?? Date.distantPast
                    result = time1 < time2 ? .orderedAscending : .orderedDescending
                case .lastEdited:
                    let time1 = book1.modifiedAt ?? Date.distantPast
                    let time2 = book2.modifiedAt ?? Date.distantPast
                    result = time1 < time2 ? .orderedAscending : .orderedDescending
                case .created:
                    let time1 = book1.createdAt ?? Date.distantPast
                    let time2 = book2.createdAt ?? Date.distantPast
                    result = time1 < time2 ? .orderedAscending : .orderedDescending
                }

                // Apply ascending/descending order
                return sortAscending ? (result == .orderedAscending) : (result == .orderedDescending)
            }

            return result
        }
    }

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
    }
    
    // MARK: - Path Utility Methods
    
    /// 根据选择的路径确定数据库根目录
    /// - Parameter selectedPath: 用户选择的路径
    /// - Returns: 数据库根目录路径
    func determineDatabaseRoot(from selectedPath: String) -> String {
        DatabasePathHelper.determineDatabaseRoot(from: selectedPath)
    }
    
    // MARK: - Public Methods
    
    func setDbRootOverride(_ path: String?) {
        dbRootOverride = path
    }
    
    func loadBooks() async {
        isLoading = true
        errorMessage = nil

        do {
            let books = try fetchBooksFromDatabase()
            self.books = books
            logger.info("Successfully loaded \(books.count) books")
        } catch {
            let errorDesc = error.localizedDescription
            logger.error("Error loading books: \(errorDesc)")
            errorMessage = errorDesc
        }

        isLoading = false
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
    
    private func fetchBooksFromDatabase() throws -> [BookListItem] {
        guard let root = dbRootOverride else {
            logger.warning("Books data root not selected; skipping load until user picks a folder")
            return []
        }
        logger.info("Books data root: \(root)")

        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

        logger.debug("Looking for annotation DB in: \(annotationDir)")
        logger.debug("Looking for books DB in: \(booksDir)")

        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            let error = "Annotation DB not found under \(annotationDir)"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        logger.info("Found annotation DB: \(annotationDB)")

        guard let booksDB = latestSQLiteFile(in: booksDir) else {
            let error = "Books DB not found under \(booksDir)"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        logger.info("Found books DB: \(booksDB)")
        self.annotationDBPath = annotationDB
        self.booksDBPath = booksDB

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
        for book in books {
            bookInfoMap[book.assetId] = book
        }

        // 创建书籍列表，包括有信息的和无信息的（缺失标题的）
        var result: [BookListItem] = []
        for stat in stats {
            let bookInfo = bookInfoMap[stat.assetId]
            let hasTitle = bookInfo != nil && !(bookInfo?.title ?? "").isEmpty
            let bookTitle = bookInfo?.title ?? ""
            let authorName = bookInfo?.author ?? ""

            let bookItem = BookListItem(
                bookId: stat.assetId,
                authorName: authorName,
                bookTitle: bookTitle,
                ibooksURL: "ibooks://assetid/\(stat.assetId)",
                highlightCount: stat.count,
                createdAt: stat.minCreationDate,
                modifiedAt: stat.maxModifiedDate,
                hasTitle: hasTitle
            )
            result.append(bookItem)
        }

        // 对于 BKLibrary 缺失的 assetId 也创建 BookListItem（如计划所述）
        // 这 should have been handled already, but let's ensure we don't miss anything
        // by including any asset IDs that were in the original counts but not in the stats

        let sorted = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
        logger.info("Built list with \(sorted.count) books (with stats and metadata)")
        return sorted
    }
    
    private func latestSQLiteFile(in dir: String) -> String? {
        let url = URL(fileURLWithPath: dir)
        logger.debug("Checking directory: \(dir)")
        
        // 检查目录是否存在
        var isDir: ObjCBool = false
        if !FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) {
            logger.warning("Directory does not exist: \(dir)")
            return nil
        }
        
        if !isDir.boolValue {
            logger.warning("Path is not a directory: \(dir)")
            return nil
        }
        
        guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else {
            logger.error("Failed to list contents of directory: \(dir)")
            return nil
        }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else {
            logger.warning("No SQLite files found in directory: \(dir)")
            return nil
        }
        let sorted = sqliteFiles.sorted { a, b in
            guard let dateA = try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                  let dateB = try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate else {
                return false
            }
            return dateA > dateB
        }
        let latestFile = sorted.first?.path
        logger.debug("Latest SQLite file in \(dir): \(latestFile ?? "none")")
        return latestFile
    }
}

// MARK: - Batch Sync (Apple Books)
extension BookViewModel {
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
                        }
                    }
                }
                await group.waitForAll()
            }
        }
    }
}