import Foundation
import SQLite3

class BookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    
    var canLoadMore: Bool { expectedTotalCount > highlights.count }
    
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private var dbHandle: OpaquePointer?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 100
    private var expectedTotalCount = 0
    
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService) {
        self.databaseService = databaseService
        self.notionService = notionService
    }
    
    deinit {
        closeHandle()
    }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) {
        errorMessage = nil
        closeHandle()
        highlights = []
        currentOffset = 0
        currentAssetId = assetId
        self.expectedTotalCount = expectedTotalCount
        
        if let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        loadNextPage(dbPath: dbPath, assetId: assetId)
    }
    
    func loadNextPage(dbPath: String?, assetId: String) {
        if isLoadingPage { return }
        if highlights.count >= expectedTotalCount { return }
        
        if currentAssetId == nil {
            currentAssetId = assetId
        }
        if dbHandle == nil, let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        guard let handle = dbHandle, let asset = currentAssetId else { return }
        
        isLoadingPage = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let rows = try self.databaseService.fetchHighlightPage(db: handle, assetId: asset, limit: self.pageSize, offset: self.currentOffset)
                let page = rows.map { r in
                    Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
                }
                DispatchQueue.main.async {
                    self.highlights.append(contentsOf: page)
                    self.currentOffset += page.count
                    self.isLoadingPage = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isLoadingPage = false
                }
            }
        }
    }
    
    private func closeHandle() {
        if let handle = dbHandle {
            databaseService.close(handle)
            dbHandle = nil
        }
    }
    
    // MARK: - Notion Sync
    func syncToNotion(book: BookListItem, dbPath: String?) {
        syncMessage = nil
        Task {
            do {
                try await performSync(book: book, dbPath: dbPath)
                await MainActor.run { self.syncMessage = "Synced to Notion" }
            } catch {
                await MainActor.run { self.syncMessage = error.localizedDescription }
            }
        }
    }
    
    private func performSync(book: BookListItem, dbPath: String?) async throws {
        guard let parentPageId = DIContainer.shared.notionConfigStore.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "Please set NOTION_PAGE_ID in Notion Integration view."])
        }
        // Ensure database exists
        let dbTitle = "syncnote"
        let databaseId: String
        if let found = try await notionService.findDatabaseId(title: dbTitle, parentPageId: parentPageId) {
            databaseId = found
        } else {
            let created = try await notionService.createDatabase(title: dbTitle)
            databaseId = created.id
        }
        // Ensure book page exists (by Asset ID)
        let pageId: String
        if let existing = try await notionService.findPageIdByAssetId(databaseId: databaseId, assetId: book.bookId) {
            pageId = existing
        } else {
            let created = try await notionService.createBookPage(databaseId: databaseId,
                                                                 bookTitle: book.bookTitle,
                                                                 author: book.authorName,
                                                                 assetId: book.bookId,
                                                                 urlString: book.ibooksURL,
                                                                 header: "Highlights")
            pageId = created.id
        }
        // Collect existing UUIDs to avoid duplicates
        let existingUUIDs = try await notionService.collectExistingUUIDs(fromPageId: pageId)
        
        // Fetch all highlights for this book in batches
        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }
        var offset = 0
        var newRows: [HighlightRow] = []
        while true {
            let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: 100, offset: offset)
            if page.isEmpty { break }
            let fresh = page.filter { !existingUUIDs.contains($0.uuid) }
            newRows.append(contentsOf: fresh)
            if page.count < 100 { break }
            offset += 100
        }
        if !newRows.isEmpty {
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: newRows)
        }
        try await notionService.updatePageHighlightCount(pageId: pageId, count: book.highlightCount)
    }
}


