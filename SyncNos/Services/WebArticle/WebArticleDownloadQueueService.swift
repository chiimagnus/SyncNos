import Foundation

// MARK: - WebArticleDownloadQueueService

/// 网页正文下载队列：支持“手动下载插队”，并确保下载任务不会因为 Detail 切换而被取消。
///
/// 设计目标：
/// - 同一 URL 只会有一个下载任务在跑（in-flight 去重）
/// - 手动触发（manual）会插队到自动任务（auto）之前
/// - 即使没有等待者（例如 Detail 切换导致等待取消），已入队的下载也继续执行并写入缓存
actor WebArticleDownloadQueueService: WebArticleDownloadQueueProtocol {
    // MARK: - Dependencies
    
    private let fetcher: WebArticleFetcherProtocol
    private let cacheService: WebArticleCacheServiceProtocol
    private let logger: LoggerServiceProtocol
    
    // MARK: - Config
    
    /// 下载并发（WebKit 抽取内部也有限流；这里额外用于做优先级调度）
    private let maxConcurrentDownloads: Int
    
    // MARK: - State
    
    private var manualQueue: [String] = []
    private var autoQueue: [String] = []
    private var inFlightTasks: [String: Task<Void, Never>] = [:]
    
    /// 等待者（url -> waiterId -> continuation）
    private var waiters: [String: [UUID: CheckedContinuation<ArticleFetchResult?, Error>]] = [:]
    
    // MARK: - Init
    
    init(
        fetcher: WebArticleFetcherProtocol = DIContainer.shared.webArticleFetcher,
        cacheService: WebArticleCacheServiceProtocol = DIContainer.shared.webArticleCacheService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        maxConcurrentDownloads: Int = 2
    ) {
        self.fetcher = fetcher
        self.cacheService = cacheService
        self.logger = logger
        self.maxConcurrentDownloads = max(1, maxConcurrentDownloads)
    }
    
    // MARK: - WebArticleDownloadQueueProtocol
    
    func enqueue(url: String, priority: WebArticleDownloadPriority) async {
        let normalized = normalizeURL(url)
        guard !normalized.isEmpty else { return }
        enqueueImpl(url: normalized, priority: priority)
    }
    
    func isActive(url: String) async -> Bool {
        let normalized = normalizeURL(url)
        guard !normalized.isEmpty else { return false }
        if inFlightTasks[normalized] != nil { return true }
        if manualQueue.contains(normalized) { return true }
        if autoQueue.contains(normalized) { return true }
        return false
    }
    
    func fetchArticle(url: String, priority: WebArticleDownloadPriority) async throws -> ArticleFetchResult? {
        let normalized = normalizeURL(url)
        guard !normalized.isEmpty else {
            throw URLFetchError.invalidURL(url)
        }
        
        do {
            if let cached = try await cacheService.getArticle(url: normalized) {
                return cached
            }
        } catch {
            logger.warning("[WebArticleQueue] Read persisted cache failed url=\(normalized) error=\(error.localizedDescription)")
        }
        
        let waiterId = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                addWaiter(url: normalized, waiterId: waiterId, continuation: continuation)
                enqueueImpl(url: normalized, priority: priority)
            }
        } onCancel: {
            // 注意：取消“等待”不应取消下载任务本身（下载应继续写入缓存）
            Task { [weak self] in
                await self?.removeWaiter(url: normalized, waiterId: waiterId)
            }
        }
    }
    
    // MARK: - Queue Operations
    
    private func enqueueImpl(url: String, priority: WebArticleDownloadPriority) {
        // 已在下载中：无需重复入队
        if inFlightTasks[url] != nil { return }
        
        // 已在队列中：manual 触发则“插队”到最前面
        if containsInQueues(url) {
            if priority == .manual {
                promoteToManualFront(url)
            }
            pumpIfNeeded()
            return
        }
        
        switch priority {
        case .manual:
            manualQueue.insert(url, at: 0)
            logger.debug("[WebArticleQueue] Enqueued manual url=\(url)")
        case .auto:
            autoQueue.append(url)
            logger.debug("[WebArticleQueue] Enqueued auto url=\(url)")
        }
        
        pumpIfNeeded()
    }
    
    private func pumpIfNeeded() {
        while inFlightTasks.count < maxConcurrentDownloads {
            guard let next = dequeueNextURL() else { return }
            startDownload(url: next)
        }
    }
    
    private func dequeueNextURL() -> String? {
        if let url = manualQueue.first {
            manualQueue.removeFirst()
            return url
        }
        if let url = autoQueue.first {
            autoQueue.removeFirst()
            return url
        }
        return nil
    }
    
    private func startDownload(url: String) {
        guard inFlightTasks[url] == nil else { return }
        logger.info("[WebArticleQueue] Start download url=\(url)")
        
        let task = Task.detached(priority: .userInitiated) { [fetcher, cacheService, logger] in
            do {
                // 再次尝试缓存（可能被其它路径写入）
                if let cached = try? await cacheService.getArticle(url: url) {
                    await self.finish(url: url, result: cached)
                    return
                }
                
                let result = try await fetcher.fetchArticle(url: url)
                await self.finish(url: url, result: result)
            } catch URLFetchError.contentNotFound {
                await self.finish(url: url, result: nil)
            } catch {
                logger.warning("[WebArticleQueue] Download failed url=\(url) error=\(error.localizedDescription)")
                await self.finish(url: url, error: error)
            }
        }
        
        inFlightTasks[url] = task
    }
    
    private func finish(url: String, result: ArticleFetchResult?) {
        inFlightTasks[url] = nil
        resumeWaiters(url: url, result: result)
        pumpIfNeeded()
    }
    
    private func finish(url: String, error: Error) {
        inFlightTasks[url] = nil
        resumeWaiters(url: url, error: error)
        pumpIfNeeded()
    }
    
    // MARK: - Waiters
    
    private func addWaiter(
        url: String,
        waiterId: UUID,
        continuation: CheckedContinuation<ArticleFetchResult?, Error>
    ) {
        var dict = waiters[url] ?? [:]
        dict[waiterId] = continuation
        waiters[url] = dict
    }
    
    private func removeWaiter(url: String, waiterId: UUID) {
        guard var dict = waiters[url] else { return }
        dict.removeValue(forKey: waiterId)
        if dict.isEmpty {
            waiters.removeValue(forKey: url)
        } else {
            waiters[url] = dict
        }
    }
    
    private func resumeWaiters(url: String, result: ArticleFetchResult?) {
        guard let dict = waiters.removeValue(forKey: url) else { return }
        for (_, continuation) in dict {
            continuation.resume(returning: result)
        }
    }
    
    private func resumeWaiters(url: String, error: Error) {
        guard let dict = waiters.removeValue(forKey: url) else { return }
        for (_, continuation) in dict {
            continuation.resume(throwing: error)
        }
    }
    
    // MARK: - Helpers
    
    private func normalizeURL(_ url: String) -> String {
        url.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    private func containsInQueues(_ url: String) -> Bool {
        manualQueue.contains(url) || autoQueue.contains(url)
    }
    
    private func promoteToManualFront(_ url: String) {
        manualQueue.removeAll(where: { $0 == url })
        autoQueue.removeAll(where: { $0 == url })
        manualQueue.insert(url, at: 0)
        logger.debug("[WebArticleQueue] Promoted to manual front url=\(url)")
    }
}
