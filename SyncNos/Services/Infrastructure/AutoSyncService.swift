import Foundation
import Combine

final class AutoSyncService: AutoSyncServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let databaseService = DIContainer.shared.databaseService
    private let syncCoordinator = DIContainer.shared.syncCoordinator
    private let notionConfig = DIContainer.shared.notionConfigStore

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?
    private var isSyncing: Bool = false

    private let intervalSeconds: TimeInterval = 15 * 60 // 15min，后续可做成设置项

    private var booksRootPath: String? {
        // 尝试从 bookmark 恢复并解析 Data/Documents 根目录
        if let url = BookmarkStore.shared.restore() {
            let selectedPath = url.path
            let vm = BookViewModel()
            return vm.determineDatabaseRoot(from: selectedPath)
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

        // 启动后立即尝试一次
        triggerSyncNow()
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

        // 取出有高亮的所有书籍 assetId
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let assetIds = counts.map { $0.assetId }
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
            do {
                try await self.syncCoordinator.syncSmart(book: book, dbPath: annotationDBPath) { progress in
                    self.logger.debug("AutoSync progress[\(id)]: \(progress)")
                }
            } catch {
                self.logger.error("AutoSync failed for \(id): \(error.localizedDescription)")
            }
        }
    }
}


