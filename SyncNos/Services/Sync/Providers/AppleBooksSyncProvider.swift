import Foundation
import Combine

final class AppleBooksSyncProvider: SyncSourceProvider {
    var source: ContentSource { .appleBooks }
    
    private let logger = DIContainer.shared.loggerService
    private let databaseService = DIContainer.shared.databaseService
    private let appleBooksSyncService = DIContainer.shared.appleBooksSyncService
    
    var isAutoSyncEnabled: Bool {
        UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
    }
    
    private var booksRootPath: String? {
        if let url = DIContainer.shared.bookmarkStore.restore() {
            return DatabasePathHelper.determineDatabaseRoot(from: url.path)
        }
        return nil
    }
    
    // Helper to find latest SQLite file
    private func latestSQLiteFile(in dir: String) -> String? {
        let url = URL(fileURLWithPath: dir)
        guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else { return nil }
        let sorted = sqliteFiles.sorted { a, b in
            (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast >
            (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast
        }
        return sorted.first?.path
    }
    
    func triggerAutoSync() async throws {
        guard isAutoSyncEnabled else { return }
        guard let root = booksRootPath else {
            logger.warning("AutoSync[AppleBooks] skipped: root not selected")
            return
        }
        
        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
        
        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            logger.warning("AutoSync[AppleBooks] skipped: annotation DB not found")
            return
        }
        let booksDB = latestSQLiteFile(in: booksDir)
        
        logger.info("AutoSync[AppleBooks]: checking for updates...")
        
        let handle = try databaseService.openReadOnlyDatabase(dbPath: annotationDB)
        defer { databaseService.close(handle) }
        
        // 1. Fetch counts to find assets with highlights
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let assetIds = counts.map { $0.assetId }.sorted()
        if assetIds.isEmpty { return }
        
        // 2. Fetch metadata
        var bookMeta: [String: BookRow] = [:]
        if let booksDBPath = booksDB, let booksSession = try? databaseService.makeReadOnlySession(dbPath: booksDBPath) {
            defer { booksSession.close() }
            if let rows = try? booksSession.fetchBooks(assetIds: assetIds) {
                for r in rows { bookMeta[r.assetId] = r }
            }
        }
        
        // 3. Filter by timestamp (incremental sync)
        let now = Date()
        let intervalSeconds: TimeInterval = 24 * 60 * 60 // Hardcoded for now, matching original
        var eligibleIds: [String] = []
        
        for id in assetIds {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id),
               now.timeIntervalSince(last) < intervalSeconds {
                // Notify skipped
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped"])
                continue
            }
            eligibleIds.append(id)
        }
        
        if eligibleIds.isEmpty {
            logger.info("AutoSync[AppleBooks]: No new items to sync")
            return
        }
        
        logger.info("AutoSync[AppleBooks]: Found \(eligibleIds.count) items to sync")
        
        // 4. Enqueue tasks for UI
        var items: [[String: Any]] = []
        items.reserveCapacity(eligibleIds.count)
        for id in eligibleIds {
            let meta = bookMeta[id]
            let title = (meta?.title.isEmpty == false) ? meta!.title : id
            let subtitle = meta?.author ?? ""
            items.append(["id": id, "title": title, "subtitle": subtitle])
        }
        if !items.isEmpty {
            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": ContentSource.appleBooks.rawValue, "items": items])
        }
        
        // 5. Execute sync with concurrency limit
        let maxConcurrent = NotionSyncConfig.batchConcurrency
        let dbPathLocal = annotationDB
        
        var nextIndex = 0
        
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]
                nextIndex += 1
                
                let meta = bookMeta[id]
                let title = meta?.title ?? id
                let author = meta?.author ?? ""
                let book = BookListItem(bookId: id, authorName: author, bookTitle: title, ibooksURL: "ibooks://assetid/\(id)", highlightCount: 0)
                
                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStarted"), object: id)
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"])
                        
                        do {
                            try await self.appleBooksSyncService.syncSmart(book: book, dbPath: dbPathLocal) { progress in
                                self.logger.debug("AutoSync[AppleBooks] progress[\(id)]: \(progress)")
                            }
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"])
                        } catch {
                            self.logger.error("AutoSync[AppleBooks] failed for \(id): \(error.localizedDescription)")
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"])
                        }
                        NotificationCenter.default.post(name: Notification.Name("SyncBookFinished"), object: id)
                    }
                }
            }
            
            for _ in 0..<min(maxConcurrent, eligibleIds.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}

