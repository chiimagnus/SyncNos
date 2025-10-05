import Foundation
import SwiftUI
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

    private let databaseService: DatabaseServiceProtocol
    private let bookmarkStore: BookmarkStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private var dbRootOverride: String?
    private var annotationDBPath: String?
    private var booksDBPath: String?
    private var cancellables: Set<AnyCancellable> = []

    // Public readonly accessors
    var annotationDatabasePath: String? { annotationDBPath }
    var booksDatabasePath: String? { booksDBPath }

    // MARK: - Initialization
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore) {
        self.databaseService = databaseService
        self.bookmarkStore = bookmarkStore
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
        
        // 获取每本书的高亮数量（而不是把全部高亮读入内存）
        let counts = try annotationSession.fetchHighlightCountsByAsset()
        let assetIds = counts.map { $0.assetId }.sorted()
        logger.info("Found \(assetIds.count) assets with highlights")
        let books = try booksSession.fetchBooks(assetIds: assetIds)
        logger.debug("Fetched \(books.count) books for counts")
        
        var countIndex: [String: Int] = [:]
        for c in counts {
            countIndex[c.assetId] = c.count
        }
        
        var result: [BookListItem] = []
        for b in books {
            let cnt = countIndex[b.assetId] ?? 0
            result.append(BookListItem(bookId: b.assetId,
                                       authorName: b.author,
                                       bookTitle: b.title,
                                       ibooksURL: "ibooks://assetid/\(b.assetId)",
                                       highlightCount: cnt))
        }
        let sorted = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
        logger.info("Built list with \(sorted.count) books (counts only)")
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