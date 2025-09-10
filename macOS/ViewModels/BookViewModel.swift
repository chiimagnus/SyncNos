import Foundation
import SwiftUI
import SQLite3

// MARK: - BookViewModel

class BookViewModel: ObservableObject {
    @Published var books: [BookListItem] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let databaseService: DatabaseServiceProtocol
    private let bookmarkStore: BookmarkStoreProtocol
    private var dbRootOverride: String?
    private var annotationDBPath: String?
    private var booksDBPath: String?
    
    // Public readonly accessors
    var annotationDatabasePath: String? { annotationDBPath }
    var booksDatabasePath: String? { booksDBPath }
    
    // MARK: - Initialization
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore) {
        self.databaseService = databaseService
        self.bookmarkStore = bookmarkStore
    }
    
    // MARK: - Path Utility Methods
    
    /// 根据选择的路径确定数据库根目录
    /// - Parameter selectedPath: 用户选择的路径
    /// - Returns: 数据库根目录路径
    func determineDatabaseRoot(from selectedPath: String) -> String {
        let fm = FileManager.default
        var rootCandidate = selectedPath
        
        // 检查是否选择了容器目录（包含Data/Documents）
        let maybeDataDocs = (selectedPath as NSString).appendingPathComponent("Data/Documents")
        let aeAnnoInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("AEAnnotation")
        let bkLibInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("BKLibrary")
        
        if fm.fileExists(atPath: aeAnnoInDataDocs) || fm.fileExists(atPath: bkLibInDataDocs) {
            rootCandidate = maybeDataDocs
        } else {
            // 检查是否直接选择了Data/Documents目录
            let aeAnno = (selectedPath as NSString).appendingPathComponent("AEAnnotation")
            let bkLib = (selectedPath as NSString).appendingPathComponent("BKLibrary")
            if fm.fileExists(atPath: aeAnno) || fm.fileExists(atPath: bkLib) {
                rootCandidate = selectedPath
            }
        }
        
        return rootCandidate
    }
    
    // MARK: - Public Methods
    
    func setDbRootOverride(_ path: String?) {
        dbRootOverride = path
    }
    
    func loadBooks() {
        isLoading = true
        errorMessage = nil
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            do {
                let books = try self.fetchBooksFromDatabase()
                DispatchQueue.main.async {
                    self.books = books
                    self.isLoading = false
                    print("Successfully loaded \(books.count) books")
                }
            } catch {
                let errorDesc = error.localizedDescription
                print("Error loading books: \(errorDesc)")
                DispatchQueue.main.async {
                    self.errorMessage = errorDesc
                    self.isLoading = false
                }
            }
        }
    }
    
    // Legacy helper kept for potential future export features
    func buildExport(annotations: [HighlightRow], books: [BookRow], filters: Filters?) -> [BookExport] {
        var highlightsByAsset: [String: [Highlight]] = [:]
        for row in annotations {
            highlightsByAsset[row.assetId, default: []].append(Highlight(uuid: row.uuid, text: row.text, note: row.note, style: row.style, dateAdded: row.dateAdded, modified: row.modified, location: row.location))
        }
        var booksIndex: [String: BookRow] = [:]
        for b in books { 
            booksIndex[b.assetId] = b 
        }
        var result: [BookExport] = []
        for (assetId, hs) in highlightsByAsset {
            guard let b = booksIndex[assetId] else { 
                continue 
            }
            if let f = filters, !self.databaseService.matches(book: b, filters: f) { 
                continue 
            }
            result.append(BookExport(bookId: assetId, authorName: b.author, bookTitle: b.title, ibooksURL: "ibooks://assetid/\(assetId)", highlights: hs))
        }
        let sortedResult = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
        print("Built export with \(sortedResult.count) books")
        return sortedResult
    }
    
    // MARK: - Private Methods
    
    private func fetchBooksFromDatabase() throws -> [BookListItem] {
        guard let root = dbRootOverride else {
            print("Books data root not selected; skipping load until user picks a folder")
            return []
        }
        print("Books data root: \(root)")
        
        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
        
        print("Looking for annotation DB in: \(annotationDir)")
        print("Looking for books DB in: \(booksDir)")
        
        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            let error = "Annotation DB not found under \(annotationDir)"
            print("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        print("Found annotation DB: \(annotationDB)")
        
        guard let booksDB = latestSQLiteFile(in: booksDir) else {
            let error = "Books DB not found under \(booksDir)"
            print("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        print("Found books DB: \(booksDB)")
        self.annotationDBPath = annotationDB
        self.booksDBPath = booksDB
        
        // 直接使用原始数据库文件路径，不进行复制
        let adbH = try databaseService.openReadOnlyDatabase(dbPath: annotationDB)
        defer { 
            databaseService.close(adbH)
            print("Closed annotation DB")
        }
        let bdbH = try databaseService.openReadOnlyDatabase(dbPath: booksDB)
        defer { 
            databaseService.close(bdbH)
            print("Closed books DB")
        }
        
        // 获取每本书的高亮数量（而不是把全部高亮读入内存）
        let counts = try databaseService.fetchHighlightCountsByAsset(db: adbH)
        let assetIds = counts.map { $0.assetId }.sorted()
        print("Found \(assetIds.count) assets with highlights")
        let books = try databaseService.fetchBooks(db: bdbH, assetIds: assetIds)
        print("Fetched \(books.count) books for counts")
        
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
        print("Built list with \(sorted.count) books (counts only)")
        return sorted
    }
    
    private func latestSQLiteFile(in dir: String) -> String? {
        let url = URL(fileURLWithPath: dir)
        print("Checking directory: \(dir)")
        
        // 检查目录是否存在
        var isDir: ObjCBool = false
        if !FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) {
            print("Directory does not exist: \(dir)")
            return nil
        }
        
        if !isDir.boolValue {
            print("Path is not a directory: \(dir)")
            return nil
        }
        
        guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else {
            print("Failed to list contents of directory: \(dir)")
            return nil
        }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else {
            print("No SQLite files found in directory: \(dir)")
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
        print("Latest SQLite file in \(dir): \(latestFile ?? "none")")
        return latestFile
    }
}