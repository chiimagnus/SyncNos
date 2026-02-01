import Foundation

// MARK: - GoodLinks Article Auto Fetch Service

/// GoodLinks 正文自动抓取服务：
/// - 列表加载完成后批量预取正文，写入持久化缓存
/// - 本次启动会话内：失败/无正文不重试
/// - 提供快照与最近事件，方便 Debug 观察
actor GoodLinksArticleAutoFetchService: GoodLinksArticleAutoFetchServiceProtocol {
    // MARK: - Dependencies
    
    private let cacheService: WebArticleCacheServiceProtocol
    private let downloadQueue: WebArticleDownloadQueueProtocol
    private let logger: LoggerServiceProtocol
    
    // MARK: - Config
    
    private let maxConcurrentPrefetches: Int
    private let maxRecentEvents: Int = 100
    
    // MARK: - State
    
    private var pending: [String] = []
    private var pendingSet: Set<String> = []
    private var inFlightTasks: [String: Task<Void, Never>] = [:]
    
    /// 本次会话已跟踪的 URL（用于 Debug UI 显示“所有状态”）
    private var itemsByURL: [String: GoodLinksAutoFetchItem] = [:]
    
    private var cacheHitCount: Int = 0
    private var succeededCount: Int = 0
    private var failedCount: Int = 0
    private var completedCount: Int = 0
    
    private var startedAt: Date?
    private var lastUpdatedAt: Date?
    private var recentEvents: [GoodLinksAutoFetchEvent] = []
    
    // MARK: - Init
    
    init(
        cacheService: WebArticleCacheServiceProtocol = DIContainer.shared.webArticleCacheService,
        downloadQueue: WebArticleDownloadQueueProtocol = DIContainer.shared.webArticleDownloadQueue,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        maxConcurrentPrefetches: Int = 2
    ) {
        self.cacheService = cacheService
        self.downloadQueue = downloadQueue
        self.logger = logger
        self.maxConcurrentPrefetches = max(1, maxConcurrentPrefetches)
    }
    
    // MARK: - GoodLinksArticleAutoFetchServiceProtocol
    
    func enqueuePrefetch(links: [GoodLinksLinkRow]) async {
        guard !links.isEmpty else { return }
        
        let urls = links.map(\.url)
        let accepted = enqueueURLs(urls)
        guard accepted > 0 else { return }
        
        if startedAt == nil {
            startedAt = Date()
            logger.info("[GoodLinksAutoFetch] Started session prefetch, concurrency=\(maxConcurrentPrefetches)")
        }
        
        logger.info("[GoodLinksAutoFetch] Enqueued urls=\(accepted) pending=\(pending.count) inFlight=\(inFlightTasks.count)")
        pumpIfNeeded()
    }
    
    func snapshot() async -> GoodLinksAutoFetchSnapshot {
        let total = itemsByURL.count
        let items = itemsByURL.values.sorted { a, b in
            if a.state != b.state {
                return stateSortKey(a.state) < stateSortKey(b.state)
            }
            return a.updatedAt > b.updatedAt
        }
        return GoodLinksAutoFetchSnapshot(
            total: total,
            pending: pending.count,
            inFlight: inFlightTasks.count,
            completed: completedCount,
            cacheHit: cacheHitCount,
            succeeded: succeededCount,
            failed: failedCount,
            startedAt: startedAt,
            lastUpdatedAt: lastUpdatedAt,
            items: items,
            recentEvents: recentEvents
        )
    }
    
    func resetSessionState() async {
        for (_, task) in inFlightTasks {
            task.cancel()
        }
        
        pending.removeAll(keepingCapacity: false)
        pendingSet.removeAll(keepingCapacity: false)
        inFlightTasks.removeAll(keepingCapacity: false)
        itemsByURL.removeAll(keepingCapacity: false)
        
        cacheHitCount = 0
        succeededCount = 0
        failedCount = 0
        completedCount = 0
        
        startedAt = nil
        lastUpdatedAt = Date()
        appendEvent(.init(url: "", kind: .reset, message: "Reset session state"))
        
        logger.info("[GoodLinksAutoFetch] Reset session state")
    }
    
    // MARK: - Queue
    
    private func enqueueURLs(_ urls: [String]) -> Int {
        var accepted = 0
        for raw in urls {
            let url = normalizeURL(raw)
            guard !url.isEmpty else { continue }
            
            if pendingSet.contains(url) { continue }
            if inFlightTasks[url] != nil { continue }
            if itemsByURL[url] != nil { continue }
            
            pending.append(url)
            pendingSet.insert(url)
            accepted += 1
            itemsByURL[url] = GoodLinksAutoFetchItem(
                url: url,
                state: .waiting,
                message: nil,
                updatedAt: Date()
            )
            appendEvent(.init(url: url, kind: .enqueued, message: nil))
        }
        if accepted > 0 {
            lastUpdatedAt = Date()
        }
        return accepted
    }
    
    private func pumpIfNeeded() {
        while inFlightTasks.count < maxConcurrentPrefetches {
            guard let next = dequeueNextURL() else { return }
            startPrefetch(url: next)
        }
    }
    
    private func dequeueNextURL() -> String? {
        while let first = pending.first {
            pending.removeFirst()
            pendingSet.remove(first)
            if inFlightTasks[first] != nil { continue }
            // 可能在队列等待时被 reset 清空
            guard let item = itemsByURL[first], item.state == .waiting else { continue }
            return first
        }
        return nil
    }
    
    private func startPrefetch(url: String) {
        guard inFlightTasks[url] == nil else { return }
        
        if let item = itemsByURL[url] {
            itemsByURL[url] = GoodLinksAutoFetchItem(
                url: item.url,
                state: .running,
                message: nil,
                updatedAt: Date()
            )
        }
        
        appendEvent(.init(url: url, kind: .started, message: nil))
        logger.debug("[GoodLinksAutoFetch] Start url=\(url)")
        
        let task = Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            await self.prefetchOne(url: url)
        }
        inFlightTasks[url] = task
        lastUpdatedAt = Date()
    }
    
    private func prefetchOne(url: String) async {
        do {
            if let cached = try await cacheService.getArticle(url: url),
               (!cached.textContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !cached.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                finish(url: url, outcome: .cacheHit)
                return
            }
        } catch {
            logger.warning("[GoodLinksAutoFetch] Read cache failed url=\(url) error=\(error.localizedDescription)")
        }
        
        do {
            let result = try await downloadQueue.fetchArticle(url: url, priority: .auto)
            if result != nil {
                finish(url: url, outcome: .succeeded)
            } else {
                finish(url: url, outcome: .noContent)
            }
        } catch is CancellationError {
            // 仅 DEBUG reset 时可能触发：视为结束但不计入失败/完成，避免污染统计
            finish(url: url, outcome: .cancelled)
        } catch {
            finish(url: url, outcome: .failed(error.localizedDescription))
        }
    }
    
    // MARK: - Finish
    
    private enum Outcome {
        case cacheHit
        case succeeded
        case noContent
        case failed(String)
        case cancelled
    }
    
    private func finish(url: String, outcome: Outcome) {
        inFlightTasks[url] = nil
        lastUpdatedAt = Date()
        
        // 可能在 debug reset 时被清空：此时不再更新计数/事件，直接泵队列即可
        if itemsByURL[url] == nil {
            switch outcome {
            case .cancelled:
                break
            case .cacheHit, .succeeded, .noContent, .failed:
                pumpIfNeeded()
                return
            }
        }
        
        switch outcome {
        case .cacheHit:
            if let item = itemsByURL[url], item.state != .cached {
                itemsByURL[url] = GoodLinksAutoFetchItem(url: url, state: .cached, message: nil, updatedAt: Date())
                completedCount += 1
            }
            cacheHitCount += 1
            appendEvent(.init(url: url, kind: .cacheHit, message: nil))
        case .succeeded:
            if let item = itemsByURL[url], item.state != .succeeded {
                itemsByURL[url] = GoodLinksAutoFetchItem(url: url, state: .succeeded, message: nil, updatedAt: Date())
                completedCount += 1
            }
            succeededCount += 1
            appendEvent(.init(url: url, kind: .succeeded, message: nil))
        case .noContent:
            if let item = itemsByURL[url], item.state != .failed {
                itemsByURL[url] = GoodLinksAutoFetchItem(url: url, state: .failed, message: "no content", updatedAt: Date())
                completedCount += 1
            }
            failedCount += 1
            appendEvent(.init(url: url, kind: .noContent, message: nil))
            logger.info("[GoodLinksAutoFetch] No content url=\(url)")
        case .failed(let message):
            if let item = itemsByURL[url], item.state != .failed {
                itemsByURL[url] = GoodLinksAutoFetchItem(url: url, state: .failed, message: message, updatedAt: Date())
                completedCount += 1
            }
            failedCount += 1
            appendEvent(.init(url: url, kind: .failed, message: message))
            logger.warning("[GoodLinksAutoFetch] Failed url=\(url) error=\(message)")
        case .cancelled:
            // 取消不应阻断未来重试（debug reset），因此直接移除记录
            itemsByURL.removeValue(forKey: url)
            appendEvent(.init(url: url, kind: .skipped, message: "cancelled"))
        }
        
        pumpIfNeeded()
        
        if pending.isEmpty, inFlightTasks.isEmpty {
            logger.info("[GoodLinksAutoFetch] Finished pending session: total=\(itemsByURL.count) completed=\(completedCount) cacheHit=\(cacheHitCount) succeeded=\(succeededCount) failed=\(failedCount)")
        }
    }
    
    // MARK: - Helpers
    
    private func appendEvent(_ event: GoodLinksAutoFetchEvent) {
        recentEvents.append(event)
        if recentEvents.count > maxRecentEvents {
            recentEvents.removeFirst(recentEvents.count - maxRecentEvents)
        }
        lastUpdatedAt = Date()
    }
    
    private func normalizeURL(_ url: String) -> String {
        url.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    private func stateSortKey(_ state: GoodLinksAutoFetchItemState) -> Int {
        switch state {
        case .running:
            return 0
        case .waiting:
            return 1
        case .failed:
            return 2
        case .succeeded:
            return 3
        case .cached:
            return 4
        }
    }
}
