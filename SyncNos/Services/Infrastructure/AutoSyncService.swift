import Foundation
import Combine

// MARK: - Database Path Helper

final class DatabasePathHelper {
    static func determineDatabaseRoot(from selectedPath: String) -> String {
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
            // 如果用户选择了 `.../Data`，则自动补上 `Documents`
            let lastPath = (selectedPath as NSString).lastPathComponent
            if lastPath == "Data" {
                let dataDocs = (selectedPath as NSString).appendingPathComponent("Documents")
                let aeAnno2 = (dataDocs as NSString).appendingPathComponent("AEAnnotation")
                let bkLib2 = (dataDocs as NSString).appendingPathComponent("BKLibrary")
                if fm.fileExists(atPath: aeAnno2) || fm.fileExists(atPath: bkLib2) {
                    rootCandidate = dataDocs
                }
            }
            // 如果用户选择了容器根 `.../Containers/com.apple.iBooksX`，则进入 `Data/Documents`
            if lastPath == "com.apple.iBooksX" || selectedPath.hasSuffix("/Containers/com.apple.iBooksX") {
                let containerDocs = (selectedPath as NSString).appendingPathComponent("Data/Documents")
                let aeAnno3 = (containerDocs as NSString).appendingPathComponent("AEAnnotation")
                let bkLib3 = (containerDocs as NSString).appendingPathComponent("BKLibrary")
                if fm.fileExists(atPath: aeAnno3) || fm.fileExists(atPath: bkLib3) {
                    rootCandidate = containerDocs
                }
            }
        }

        return rootCandidate
    }
}

final class AutoSyncService: AutoSyncServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let databaseService = DIContainer.shared.databaseService
    private let appleBooksSyncService = DIContainer.shared.appleBooksSyncService
    private let notionConfig = DIContainer.shared.notionConfigStore
    private let goodLinksService = DIContainer.shared.goodLinksService
    private let goodLinksSyncService = GoodLinksSyncService()

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?
    private var isSyncing: Bool = false

    private let intervalSeconds: TimeInterval = 24 * 60 * 60 // 24小时，后续可做成设置项

    private var booksRootPath: String? {
        // 尝试从 bookmark 恢复并解析 Data/Documents 根目录
        if let url = BookmarkStore.shared.restore() {
            let selectedPath = url.path
            return DatabasePathHelper.determineDatabaseRoot(from: selectedPath)
        }
        return nil
    }

    var isRunning: Bool {
        timerCancellable != nil
    }

    func start() {
        guard timerCancellable == nil else { return }
        logger.info("AutoSyncService starting…")
        // 监听数据源选择完成或刷新事件，触发一次同步
        notificationCancellable = NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshGoodLinksRequested")))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.triggerSyncNow()
            }

        // 定时增量同步
        timerCancellable = Timer.publish(every: intervalSeconds, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.triggerSyncNow()
            }
    }

    func stop() {
        timerCancellable?.cancel(); timerCancellable = nil
        notificationCancellable?.cancel(); notificationCancellable = nil
        logger.info("AutoSyncService stopped")
    }

    func triggerSyncNow() {
        guard !isSyncing else { return }
        guard notionConfig.isConfigured else {
            logger.warning("AutoSync skipped: Notion not configured")
            return
        }
        // Determine Apple Books root if present
        let root = booksRootPath

        var annotationDB: String? = nil
        var booksDB: String? = nil
        if let root {
            let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
            let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
            annotationDB = latestSQLiteFile(in: annotationDir)
            booksDB = latestSQLiteFile(in: booksDir)
            if annotationDB == nil {
                logger.warning("AutoSync: Apple Books annotation DB not found; skipping books sync")
            }
        } else {
            logger.info("AutoSync: Apple Books root not selected; skipping books sync")
        }

        // GoodLinks DB resolution
        let goodLinksDBPath = goodLinksService.resolveDatabasePath()

        isSyncing = true
        logger.info("AutoSync: start smart sync for available sources")
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("AutoSync: finished")
            }
            do {
                // Books sync if annotation DB available
                if let annotationDB {
                    try await self.syncAllBooksSmart(annotationDBPath: annotationDB, booksDBPath: booksDB)
                }
            } catch {
                self.logger.error("AutoSync books error: \(error.localizedDescription)")
            }

            // GoodLinks sync if db exists and accessible
            do {
                if !goodLinksDBPath.isEmpty, goodLinksService.canOpenReadOnly(dbPath: goodLinksDBPath) {
                    try await self.syncAllGoodLinksSmart(dbPath: goodLinksDBPath)
                } else {
                    self.logger.info("AutoSync: GoodLinks DB not available; skipping GoodLinks sync")
                }
            } catch {
                self.logger.error("AutoSync GoodLinks error: \(error.localizedDescription)")
            }
        }
    }

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

    private func syncAllBooksSmart(annotationDBPath: String, booksDBPath: String?) async throws {
        let handle = try databaseService.openReadOnlyDatabase(dbPath: annotationDBPath)
        defer { databaseService.close(handle) }

        // 取出有高亮的所有书籍 assetId（稳定排序，避免边界项被跳过）
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let assetIds = counts.map { $0.assetId }.sorted()
        if assetIds.isEmpty { return }

        // 构造资产到书名/作者映射
        var bookMeta: [String: BookRow] = [:]
        if let booksDBPath, let booksSession = try? databaseService.makeReadOnlySession(dbPath: booksDBPath) {
            defer { booksSession.close() }
            if let rows = try? booksSession.fetchBooks(assetIds: assetIds) {
                for r in rows { bookMeta[r.assetId] = r }
            }
        }

        // 并发上限（书本级并行数）
        let maxConcurrentBooks = 10

        // 预过滤近 24 小时已同步过的书籍，并即时发送跳过通知
        let now = Date()
        var eligibleIds: [String] = []
        for id in assetIds {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id), now.timeIntervalSince(last) < intervalSeconds {
                self.logger.info("AutoSync skipped for \(id): recent sync")
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped"]) 
                continue
            }
            eligibleIds.append(id)
        }
        if eligibleIds.isEmpty { return }

        // 局部引用，避免在并发闭包中强捕获 self 成员
        let logger = self.logger
        let syncService = self.appleBooksSyncService
        let dbPathLocal = annotationDBPath

        // 有界并发：最多同时处理 maxConcurrentBooks 本书
        var nextIndex = 0
        try await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]; nextIndex += 1
                let meta = bookMeta[id]
                let title = meta?.title ?? id
                let author = meta?.author ?? ""
                let book = BookListItem(bookId: id, authorName: author, bookTitle: title, ibooksURL: "ibooks://assetid/\(id)", highlightCount: 0)

                group.addTask {
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStarted"), object: id)
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"]) 
                    do {
                        try await syncService.syncSmart(book: book, dbPath: dbPathLocal) { progress in
                            logger.debug("AutoSync progress[\(id)]: \(progress)")
                        }
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"]) 
                    } catch {
                        logger.error("AutoSync failed for \(id): \(error.localizedDescription)")
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"]) 
                    }
                    NotificationCenter.default.post(name: Notification.Name("SyncBookFinished"), object: id)
                    // 微等待，避免连续压测导致 RunLoop 乱序日志或 IMK 警告
                    try? await Task.sleep(nanoseconds: 50_000_000)
                }
            }

            // 初始填充任务
            for _ in 0..<min(maxConcurrentBooks, eligibleIds.count) { addTaskIfPossible() }
            // 滑动补位，始终保持最多 maxConcurrentBooks 在执行
            while await group.next() != nil { addTaskIfPossible() }
        }
    }

    // MARK: - GoodLinks Smart Sync
    private func syncAllGoodLinksSmart(dbPath: String) async throws {
        let handle = try goodLinksService.openReadOnlyDatabase(dbPath: dbPath)
        defer { goodLinksService.close(handle) }

        let counts = try GoodLinksQueryService().fetchHighlightCountsByLink(db: handle)
        let linkIds = counts.map { $0.linkId }.sorted()
        if linkIds.isEmpty { return }

        let maxConcurrentLinks = 10

        let now = Date()
        var eligibleIds: [String] = []
        for id in linkIds {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id), now.timeIntervalSince(last) < intervalSeconds {
                self.logger.info("AutoSync skipped GoodLinks for \(id): recent sync")
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped", "source": "goodlinks"]) 
                continue
            }
            eligibleIds.append(id)
        }
        if eligibleIds.isEmpty { return }

        var nextIndex = 0
        let logger = self.logger
        let syncService = self.goodLinksSyncService

        try await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]; nextIndex += 1
                group.addTask {
                    NotificationCenter.default.post(name: Notification.Name("SyncLinkStarted"), object: id)
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started", "source": "goodlinks"]) 
                    do {
                        // fetch link row
                        if let rows = try? goodLinksService.fetchRecentLinks(dbPath: dbPath, limit: 0), let linkRow = rows.first(where: { $0.id == id }) {
                            try await syncService.syncHighlights(for: linkRow, dbPath: dbPath) { progress in
                                logger.debug("AutoSync GoodLinks progress[\(id)]: \(progress)")
                            }
                        } else {
                            logger.warning("AutoSync GoodLinks: link metadata not found for \(id)")
                        }
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded", "source": "goodlinks"]) 
                    } catch {
                        logger.error("AutoSync GoodLinks failed for \(id): \(error.localizedDescription)")
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed", "source": "goodlinks"]) 
                    }
                    NotificationCenter.default.post(name: Notification.Name("SyncLinkFinished"), object: id)
                    try? await Task.sleep(nanoseconds: 50_000_000)
                }
            }

            for _ in 0..<min(maxConcurrentLinks, eligibleIds.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}


