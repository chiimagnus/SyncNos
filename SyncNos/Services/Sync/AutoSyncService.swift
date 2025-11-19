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
    private let goodLinksDatabaseService = DIContainer.shared.goodLinksService
    private let goodLinksSyncService: GoodLinksSyncServiceProtocol = GoodLinksSyncService()
    private let notionConfig = DIContainer.shared.notionConfigStore

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?
    private var isSyncingAppleBooks: Bool = false
    private var isSyncingGoodLinks: Bool = false

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
        // 监听数据源选择完成或刷新事件，触发一次同步（Apple Books 与 GoodLinks）
        notificationCancellable = NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")))
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
        guard notionConfig.isConfigured else {
            logger.warning("AutoSync skipped: Notion not configured")
            return
        }
        triggerAppleBooksSyncNow()
        triggerGoodLinksSyncNow()
    }

    // New public per-source triggers
    func triggerAppleBooksNow() {
        triggerAppleBooksSyncNow()
    }

    func triggerGoodLinksNow() {
        triggerGoodLinksSyncNow()
    }

    private func triggerAppleBooksSyncNow() {
        guard !isSyncingAppleBooks else { return }
        let appleAutoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
        guard appleAutoSyncEnabled else { return }
        guard let root = booksRootPath else {
            logger.warning("AutoSync skipped: Apple Books root not selected")
            return
        }
        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            logger.warning("AutoSync skipped: annotation DB not found")
            return
        }
        let booksDB = latestSQLiteFile(in: booksDir)

        isSyncingAppleBooks = true
        logger.info("AutoSync[AppleBooks]: start syncSmart for all books")
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer { self.isSyncingAppleBooks = false; self.logger.info("AutoSync[AppleBooks]: finished") }
            do {
                try await self.syncAllBooksSmart(annotationDBPath: annotationDB, booksDBPath: booksDB)
            } catch {
                self.logger.error("AutoSync[AppleBooks] error: \(error.localizedDescription)")
            }
        }
    }

    private func triggerGoodLinksSyncNow() {
        guard !isSyncingGoodLinks else { return }
        let goodLinksAutoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        guard goodLinksAutoSyncEnabled else { return }
        // 解析 GoodLinks DB 路径（会自动处理安全范围访问）
        let dbPath = goodLinksDatabaseService.resolveDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            logger.warning("AutoSync skipped: GoodLinks DB not found at \(dbPath)")
            return
        }

        isSyncingGoodLinks = true
        logger.info("AutoSync[GoodLinks]: start sync for eligible links")
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncingGoodLinks = false
                GoodLinksBookmarkStore.shared.stopAccessingIfNeeded()
                self.logger.info("AutoSync[GoodLinks]: finished")
            }
            do {
                try await self.syncAllGoodLinksSmart(dbPath: dbPath)
            } catch {
                self.logger.error("AutoSync[GoodLinks] error: \(error.localizedDescription)")
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
        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency

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

        // 在队列中入队（queued），以便 SyncQueueView 正确展示 AutoSync 任务
        do {
            var items: [[String: Any]] = []
            items.reserveCapacity(eligibleIds.count)
            for id in eligibleIds {
                let meta = bookMeta[id]
                let title = (meta?.title.isEmpty == false) ? meta!.title : id
                let subtitle = meta?.author ?? ""
                items.append(["id": id, "title": title, "subtitle": subtitle])
            }
            if !items.isEmpty {
                NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": "appleBooks", "items": items])
            }
        }

        // 有界并发：最多同时处理 maxConcurrentBooks 本书
        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]; nextIndex += 1
                let meta = bookMeta[id]
                let title = meta?.title ?? id
                let author = meta?.author ?? ""
                let book = BookListItem(bookId: id, authorName: author, bookTitle: title, ibooksURL: "ibooks://assetid/\(id)", highlightCount: 0)

                group.addTask {
                    // 与手动批量共享全局并发限制器，确保全局并发不超过 NotionSyncConfig.batchConcurrency
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
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
                    }
                }
            }

            // 初始填充任务
            for _ in 0..<min(maxConcurrentBooks, eligibleIds.count) { addTaskIfPossible() }
            // 滑动补位，始终保持最多 maxConcurrentBooks 在执行
            while await group.next() != nil { addTaskIfPossible() }
        }
    }

    private func syncAllGoodLinksSmart(dbPath: String) async throws {
        // 打开只读会话
        let session = try goodLinksDatabaseService.makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }

        // 读取所有链接（包含高亮数为 0 的链接），确保不对链接进行预过滤
        let allLinks = try session.fetchRecentLinks(limit: 0)
        let linkIds = allLinks.map { $0.id }.sorted()
        if linkIds.isEmpty { return }

        // 构造 id -> 元数据映射
        var linkMeta: [String: GoodLinksLinkRow] = [:]
        for link in allLinks { linkMeta[link.id] = link }

        // 并发上限（链接级并行数）
        let maxConcurrentLinks = NotionSyncConfig.batchConcurrency

        // 24 小时内已同步过则跳过
        let now = Date()
        var eligibleIds: [String] = []
        for id in linkIds {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id), now.timeIntervalSince(last) < intervalSeconds {
                self.logger.info("AutoSync skipped for GoodLinks[\(id)]: recent sync")
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped"]) 
                continue
            }
            eligibleIds.append(id)
        }
        if eligibleIds.isEmpty { return }

        // 入队队列，便于 UI 展示
        do {
            var items: [[String: Any]] = []
            items.reserveCapacity(eligibleIds.count)
            for id in eligibleIds {
                let meta = linkMeta[id]
                let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
                let subtitle = meta?.author ?? ""
                items.append(["id": id, "title": title, "subtitle": subtitle])
            }
            if !items.isEmpty {
                NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": "goodLinks", "items": items])
            }
        }

        // 控制并发同步
        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]; nextIndex += 1
                let meta = linkMeta[id]
                let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
                let author = meta?.author ?? ""
                // 构造行数据以传入同步服务
                let row = GoodLinksLinkRow(
                    id: id,
                    url: meta?.url ?? id,
                    originalURL: meta?.originalURL,
                    title: title,
                    summary: meta?.summary,
                    author: author,
                    tags: meta?.tags,
                    starred: meta?.starred ?? false,
                    readAt: meta?.readAt ?? 0,
                    addedAt: meta?.addedAt ?? 0,
                    modifiedAt: meta?.modifiedAt ?? 0,
                    highlightTotal: meta?.highlightTotal
                )

                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"]) 
                        do {
                            try await self.goodLinksSyncService.syncHighlights(for: row, dbPath: dbPath, pageSize: NotionSyncConfig.goodLinksPageSize) { progress in
                                NotificationCenter.default.post(name: Notification.Name("SyncProgressUpdated"), object: nil, userInfo: ["bookId": id, "progress": progress])
                            }
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"]) 
                        } catch {
                            self.logger.error("AutoSync[GoodLinks] failed for \(id): \(error.localizedDescription)")
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"]) 
                        }
                    }
                }
            }

            for _ in 0..<min(maxConcurrentLinks, eligibleIds.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}
