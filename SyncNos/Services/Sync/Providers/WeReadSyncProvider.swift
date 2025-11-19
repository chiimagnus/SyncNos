import Foundation
import Combine

@available(macOS 14.0, *)
final class WeReadSyncProvider: SyncSourceProvider {
    var source: ContentSource { .weRead }
    
    private let apiService = WeReadAPIService()
    private let dataService = WeReadDataService.shared
    private let logger = DIContainer.shared.loggerService
    private let notionService = DIContainer.shared.notionService
    private let notionConfig = DIContainer.shared.notionConfigStore
    
    var isAutoSyncEnabled: Bool {
        UserDefaults.standard.bool(forKey: "autoSync.weRead")
    }
    
    func triggerAutoSync() async throws {
        guard isAutoSyncEnabled else { return }
        guard WeReadAuthService.shared.isLoggedIn else {
            logger.warning("AutoSync[WeRead] skipped: Not logged in")
            return
        }
        
        logger.info("AutoSync[WeRead]: checking for updates...")
        
        // 1. Fetch Notebooks (Book List)
        let notebookResponse = try await apiService.getNotebooks()
        let books = notebookResponse.books
        
        if books.isEmpty {
            logger.info("AutoSync[WeRead]: No books found")
            return
        }
        
        // 2. Save Books Metadata locally
        for bookMeta in books {
            _ = await dataService.saveBook(bookMeta.book)
        }
        
        // 3. Determine eligible books (Incremental)
        let now = Date()
        let intervalSeconds: TimeInterval = 24 * 60 * 60
        var eligibleBooks: [WeReadBookMetadata] = []
        
        for book in books {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId),
               now.timeIntervalSince(last) < intervalSeconds {
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": book.bookId, "status": "skipped"])
                continue
            }
            eligibleBooks.append(book)
        }
        
        if eligibleBooks.isEmpty {
            logger.info("AutoSync[WeRead]: No new items to sync")
            return
        }
        
        // 4. Enqueue Tasks
        var items: [[String: Any]] = []
        items.reserveCapacity(eligibleBooks.count)
        for b in eligibleBooks {
            items.append([
                "id": b.bookId,
                "title": b.book.title,
                "subtitle": b.book.author
            ])
        }
        if !items.isEmpty {
            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": ContentSource.weRead.rawValue, "items": items])
        }
        
        // 5. Execute Sync
        let maxConcurrent = NotionSyncConfig.batchConcurrency
        var nextIndex = 0
        
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleBooks.count else { return }
                let bookMeta = eligibleBooks[nextIndex]
                nextIndex += 1
                
                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        await self.syncBook(bookMeta)
                    }
                }
            }
            
            for _ in 0..<min(maxConcurrent, eligibleBooks.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
    
    // Single Book Sync Logic
    private func syncBook(_ bookMeta: WeReadBookMetadata) async {
        let bookId = bookMeta.bookId
        let title = bookMeta.book.title
        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": bookId, "status": "started"])
        
        do {
            // 1. Fetch Highlights & Reviews from API
            async let highlightsResp = apiService.getBookmarks(bookId: bookId)
            async let reviewsResp = apiService.getReviews(bookId: bookId)
            
            let (highlights, reviews) = try await (highlightsResp, reviewsResp)
            
            // 2. Save to Local DB
            try await dataService.saveHighlights(bookId: bookId, highlights: highlights.updated ?? [], reviews: reviews.reviews)
            
            // 3. Prepare for Notion
            guard let localBook = await dataService.fetchBook(bookId: bookId) else { return }
            let sortedHighlights = localBook.highlights.sorted { $0.createTime < $1.createTime }
            
            if sortedHighlights.isEmpty {
                logger.info("AutoSync[WeRead] skipped \(title): No highlights")
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": bookId, "status": "succeeded"])
                return
            }
            
            // 4. Sync to Notion
            try await syncToNotion(book: localBook, highlights: sortedHighlights)
            
            // 5. Update Timestamp
            SyncTimestampStore.shared.setLastSyncTime(for: bookId, to: Date())
            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": bookId, "status": "succeeded"])
            
        } catch {
            logger.error("AutoSync[WeRead] failed for \(title): \(error)")
            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": bookId, "status": "failed"])
        }
    }
    
    private func syncToNotion(book: WeReadBook, highlights: [WeReadHighlight]) async throws {
        // Similar logic to AppleBooksSyncService/GoodLinksSyncService
        
        // A. Ensure Database
        let parentPageId = notionConfig.notionPageId ?? ""
        let databaseId: String
        if let persisted = notionConfig.databaseIdForSource("weRead") {
             if await notionService.databaseExists(databaseId: persisted) {
                databaseId = persisted
            } else {
                notionConfig.setDatabaseId(nil, forSource: "weRead")
                databaseId = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-WeRead", parentPageId: parentPageId, sourceKey: "weRead")
            }
        } else {
            databaseId = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-WeRead", parentPageId: parentPageId, sourceKey: "weRead")
        }
        
        // Ensure properties (WeRead specific?)
        // Reusing default properties + maybe "Review"? For now stick to default schema
        let definitions: [String: Any] = [
            "Author": ["rich_text": [:]],
            "Category": ["select": [:]],
            "Last Sync Time": ["date": [:]]
        ]
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: definitions)
        
        // B. Ensure Page
        let ensured = try await notionService.ensureBookPageInDatabase(
            databaseId: databaseId,
            bookTitle: book.title,
            author: book.author,
            assetId: book.bookId,
            urlString: "https://weread.qq.com/web/reader/\(book.bookId)", // Approximate URL
            header: nil
        )
        let pageId = ensured.id
        let created = ensured.created
        
        // C. Sync Highlights
        // Convert WeReadHighlight to HighlightRow
        let rows = highlights.map { h in
            HighlightRow(
                assetId: book.bookId,
                uuid: h.bookmarkId, // Use bookmarkId as UUID
                text: h.text,
                note: h.note,
                style: h.style,
                dateAdded: h.createTime,
                modified: nil,
                location: nil
            )
        }
        
        // Re-use NotionService logic
        if created {
             try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: rows)
        } else {
             // Update existing page
             // Logic to append new highlights or update existing ones
             let existingMap = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
             var toAppend: [HighlightRow] = []
             
             for row in rows {
                 if existingMap[row.uuid] == nil {
                     toAppend.append(row)
                 }
                 // Could handle updates if we implement token comparison
             }
             
             if !toAppend.isEmpty {
                 try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
             }
        }
        
        // D. Update Page Metadata
        try await notionService.updatePageHighlightCount(pageId: pageId, count: rows.count)
        let nowString = NotionServiceCore.systemTimeZoneIsoDateFormatter.string(from: Date())
        try await notionService.updatePageProperties(pageId: pageId, properties: [
            "Last Sync Time": ["date": ["start": nowString]],
             "Author": ["rich_text": [["text": ["content": book.author]]]]
        ])
    }
}

