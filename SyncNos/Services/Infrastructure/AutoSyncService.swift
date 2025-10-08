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

        isSyncing = true
        logger.info("AutoSync: start syncSmart for all books")
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            do {
                try await self.syncAllBooksSmart(annotationDBPath: annotationDB, booksDBPath: booksDB)
            } catch {
                self.logger.error("AutoSync error: \(error.localizedDescription)")
            }
            self.isSyncing = false
            self.logger.info("AutoSync: finished")
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

        for id in assetIds {
            let meta = bookMeta[id]
            let title = meta?.title ?? id
            let author = meta?.author ?? ""
            let book = BookListItem(bookId: id, authorName: author, bookTitle: title, ibooksURL: "ibooks://assetid/\(id)", highlightCount: 0)

            // 如果该书在 intervalSeconds 之内已同步过，则跳过自动同步
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id) {
                let elapsed = Date().timeIntervalSince(last)
                if elapsed < intervalSeconds {
                    self.logger.info("AutoSync skipped for \(id): last sync \(Int(elapsed))s ago")
                    NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped"]) 
                    continue
                }
            }

            do {
                NotificationCenter.default.post(name: Notification.Name("SyncBookStarted"), object: id)
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"])
                try await self.appleBooksSyncService.syncSmart(book: book, dbPath: annotationDBPath) { progress in
                    self.logger.debug("AutoSync progress[\(id)]: \(progress)")
                }
                // 成功
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"])                
            } catch {
                self.logger.error("AutoSync failed for \(id): \(error.localizedDescription)")
                // 破坏性变更：移除降级到增量同步的尝试，直接视为失败并上报
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"])
            }
            NotificationCenter.default.post(name: Notification.Name("SyncBookFinished"), object: id)
            // 微等待，避免连续压测导致 RunLoop 乱序日志或 IMK 警告
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }
}


