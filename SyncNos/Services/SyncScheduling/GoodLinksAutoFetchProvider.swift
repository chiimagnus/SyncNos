import Foundation
import os

/// GoodLinks 自动预取提供者：按用户列表排序从上到下抓取正文并写入本地缓存。
///
/// 约束：
/// - 仅当 `datasource.goodLinks.enabled == true` 时运行
/// - 失败仅本轮跳过，下轮继续尝试
final class GoodLinksAutoFetchProvider: AutoFetchSourceProvider {
    let id: ContentSource = .goodLinks

    private let logger: LoggerServiceProtocol
    private let goodLinksDatabaseService: GoodLinksDatabaseServiceExposed
    private let urlFetcher: WebArticleFetcherProtocol
    private let cacheService: WebArticleCacheServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private let isFetchingLock = OSAllocatedUnfairLock(initialState: false)

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        goodLinksDatabaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        urlFetcher: WebArticleFetcherProtocol = DIContainer.shared.webArticleFetcher,
        cacheService: WebArticleCacheServiceProtocol = DIContainer.shared.webArticleCacheService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.logger = logger
        self.goodLinksDatabaseService = goodLinksDatabaseService
        self.urlFetcher = urlFetcher
        self.cacheService = cacheService
        self.syncTimestampStore = syncTimestampStore
    }

    // MARK: - AutoFetchSourceProvider

    func triggerScheduledFetch() {
        runIfNeeded()
    }

    func triggerManualFetchNow() {
        runIfNeeded()
    }

    // MARK: - Private

    private func runIfNeeded() {
        guard Self.isGoodLinksDatasourceEnabled else { return }

        let didStart = isFetchingLock.withLock { isFetching in
            if isFetching { return false }
            isFetching = true
            return true
        }
        guard didStart else { return }

        let dbPath = goodLinksDatabaseService.resolveDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            logger.warning("[AutoFetch][GoodLinks] skipped: DB not found at \(dbPath)")
            isFetchingLock.withLock { $0 = false }
            return
        }
        guard goodLinksDatabaseService.canOpenReadOnly(dbPath: dbPath) else {
            logger.warning("[AutoFetch][GoodLinks] skipped: cannot open DB at \(dbPath)")
            isFetchingLock.withLock { $0 = false }
            return
        }

        logger.info("[AutoFetch][GoodLinks] starting…")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isFetchingLock.withLock { $0 = false }
                self.logger.info("[AutoFetch][GoodLinks] finished")
            }
            await self.fetchAllIfNeeded(dbPath: dbPath)
        }
    }

    private func fetchAllIfNeeded(dbPath: String) async {
        do {
            let session = try goodLinksDatabaseService.makeReadOnlySession(dbPath: dbPath)
            defer { session.close() }

            let links = try session.fetchRecentLinks(limit: 0)
            if links.isEmpty { return }

            let prefs = GoodLinksListOrderBuilder.Preferences.load()
            let ordered = GoodLinksListOrderBuilder.sortedLinks(
                links,
                sortKey: prefs.sortKey,
                sortAscending: prefs.sortAscending,
                syncTimestampStore: syncTimestampStore
            )

            let total = ordered.count
            var fetchedCount = 0
            var skippedCount = 0
            var cacheHitCount = 0
            var processedCount = 0

            Self.postProgress(
                processed: processedCount,
                total: total,
                cached: cacheHitCount + fetchedCount,
                fetched: fetchedCount,
                skipped: skippedCount,
                running: true
            )

            for link in ordered {
                if Task.isCancelled { return }

                do {
                    if (try? await cacheService.getArticle(url: link.url)) != nil {
                        cacheHitCount += 1
                        processedCount += 1
                        Self.postProgress(
                            processed: processedCount,
                            total: total,
                            cached: cacheHitCount + fetchedCount,
                            fetched: fetchedCount,
                            skipped: skippedCount,
                            running: true
                        )
                        continue
                    }

                    _ = try await urlFetcher.fetchArticle(url: link.url)
                    fetchedCount += 1
                } catch {
                    skippedCount += 1
                    logger.debug("[AutoFetch][GoodLinks] skipped url=\(link.url) error=\(error.localizedDescription)")
                }

                processedCount += 1
                Self.postProgress(
                    processed: processedCount,
                    total: total,
                    cached: cacheHitCount + fetchedCount,
                    fetched: fetchedCount,
                    skipped: skippedCount,
                    running: true
                )

                try? await Task.sleep(nanoseconds: 250_000_000)
            }

            logger.info("[AutoFetch][GoodLinks] done total=\(ordered.count) cacheHit=\(cacheHitCount) fetched=\(fetchedCount) skipped=\(skippedCount)")
            Self.postProgress(
                processed: processedCount,
                total: total,
                cached: cacheHitCount + fetchedCount,
                fetched: fetchedCount,
                skipped: skippedCount,
                running: false
            )
        } catch {
            logger.error("[AutoFetch][GoodLinks] failed: \(error.localizedDescription)")
        }
    }

    private static var isGoodLinksDatasourceEnabled: Bool {
        (UserDefaults.standard.object(forKey: "datasource.goodLinks.enabled") as? Bool) ?? false
    }

    private static func postProgress(
        processed: Int,
        total: Int,
        cached: Int,
        fetched: Int,
        skipped: Int,
        running: Bool
    ) {
        NotificationCenter.default.post(
            name: .goodLinksAutoFetchProgressUpdated,
            object: nil,
            userInfo: [
                "processed": processed,
                "total": total,
                "cached": cached,
                "fetched": fetched,
                "skipped": skipped,
                "running": running
            ]
        )
    }
}
