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
    
    private var pendingLinkIds: [String] = []
    private var pendingLinkIdSet: Set<String> = []
    private var inFlightTasksByLinkId: [String: Task<Void, Never>] = [:]
    
    /// 本次会话已跟踪的 URL（用于 Debug UI 显示“所有状态”）
    private var itemsByLinkId: [String: GoodLinksAutoFetchItem] = [:]
    
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
        
        let accepted = enqueueLinks(links)
        guard accepted > 0 else { return }
        
        if startedAt == nil {
            startedAt = Date()
            logger.info("[GoodLinksAutoFetch] Started session prefetch, concurrency=\(maxConcurrentPrefetches)")
        }
        
        logger.info("[GoodLinksAutoFetch] Enqueued links=\(accepted) pending=\(pendingLinkIds.count) inFlight=\(inFlightTasksByLinkId.count)")
        pumpIfNeeded()
    }
    
    func snapshot() async -> GoodLinksAutoFetchSnapshot {
        let total = itemsByLinkId.count
        let items = itemsByLinkId.values.sorted { a, b in
            if a.state != b.state {
                return stateSortKey(a.state) < stateSortKey(b.state)
            }
            return a.updatedAt > b.updatedAt
        }
        return GoodLinksAutoFetchSnapshot(
            total: total,
            pending: pendingLinkIds.count,
            inFlight: inFlightTasksByLinkId.count,
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

    // MARK: - Queue
    
    private func enqueueLinks(_ links: [GoodLinksLinkRow]) -> Int {
        var accepted = 0
        for link in links {
            let linkId = link.id.trimmingCharacters(in: .whitespacesAndNewlines)
            let url = normalizeURL(link.url)
            guard !linkId.isEmpty, !url.isEmpty else { continue }
            
            let title = normalizeTitle(link.title) ?? url
            
            if pendingLinkIdSet.contains(linkId) { continue }
            if inFlightTasksByLinkId[linkId] != nil { continue }
            if itemsByLinkId[linkId] != nil { continue }
            
            pendingLinkIds.append(linkId)
            pendingLinkIdSet.insert(linkId)
            accepted += 1
            itemsByLinkId[linkId] = GoodLinksAutoFetchItem(
                linkId: linkId,
                title: title,
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
        while inFlightTasksByLinkId.count < maxConcurrentPrefetches {
            guard let next = dequeueNextLinkId() else { return }
            startPrefetch(linkId: next)
        }
    }
    
    private func dequeueNextLinkId() -> String? {
        while let first = pendingLinkIds.first {
            pendingLinkIds.removeFirst()
            pendingLinkIdSet.remove(first)
            if inFlightTasksByLinkId[first] != nil { continue }
            // 可能在队列等待时被清空（例如服务生命周期变化）
            guard let item = itemsByLinkId[first], item.state == .waiting else { continue }
            return first
        }
        return nil
    }
    
    private func startPrefetch(linkId: String) {
        guard inFlightTasksByLinkId[linkId] == nil else { return }
        guard let existing = itemsByLinkId[linkId] else { return }
        
        itemsByLinkId[linkId] = GoodLinksAutoFetchItem(
            linkId: linkId,
            title: existing.title,
            url: existing.url,
            state: .running,
            message: nil,
            updatedAt: Date()
        )
        
        appendEvent(.init(url: existing.url, kind: .started, message: nil))
        logger.debug("[GoodLinksAutoFetch] Start url=\(existing.url)")
        
        let task = Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            await self.prefetchOne(linkId: linkId)
        }
        inFlightTasksByLinkId[linkId] = task
        lastUpdatedAt = Date()
    }
    
    private func prefetchOne(linkId: String) async {
        guard let item = itemsByLinkId[linkId] else { return }
        let url = item.url
        
        do {
            if let cached = try await cacheService.getArticle(url: url),
               (!cached.textContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !cached.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                finish(linkId: linkId, outcome: .cacheHit)
                return
            }
        } catch {
            logger.warning("[GoodLinksAutoFetch] Read cache failed url=\(url) error=\(error.localizedDescription)")
        }
        
        do {
            let result = try await downloadQueue.fetchArticle(url: url, priority: .auto)
            if result != nil {
                finish(linkId: linkId, outcome: .succeeded)
            } else {
                finish(linkId: linkId, outcome: .noContent)
            }
        } catch is CancellationError {
            // 取消属于正常流程：不计入失败/完成，避免污染统计
            finish(linkId: linkId, outcome: .cancelled)
        } catch {
            finish(linkId: linkId, outcome: .failed(error.localizedDescription))
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
    
    private func finish(linkId: String, outcome: Outcome) {
        inFlightTasksByLinkId[linkId] = nil
        lastUpdatedAt = Date()
        
        // 可能在运行中被清空：此时不再更新计数/事件，直接泵队列即可
        if itemsByLinkId[linkId] == nil {
            switch outcome {
            case .cancelled:
                break
            case .cacheHit, .succeeded, .noContent, .failed:
                pumpIfNeeded()
                return
            }
        }
        
        guard let current = itemsByLinkId[linkId] else {
            pumpIfNeeded()
            return
        }
        
        let url = current.url
        
        switch outcome {
        case .cacheHit:
            if current.state != .cached {
                itemsByLinkId[linkId] = GoodLinksAutoFetchItem(linkId: linkId, title: current.title, url: url, state: .cached, message: nil, updatedAt: Date())
                completedCount += 1
            }
            cacheHitCount += 1
            appendEvent(.init(url: url, kind: .cacheHit, message: nil))
        case .succeeded:
            if current.state != .succeeded {
                itemsByLinkId[linkId] = GoodLinksAutoFetchItem(linkId: linkId, title: current.title, url: url, state: .succeeded, message: nil, updatedAt: Date())
                completedCount += 1
            }
            succeededCount += 1
            appendEvent(.init(url: url, kind: .succeeded, message: nil))
        case .noContent:
            if current.state != .failed {
                itemsByLinkId[linkId] = GoodLinksAutoFetchItem(linkId: linkId, title: current.title, url: url, state: .failed, message: "no content", updatedAt: Date())
                completedCount += 1
            }
            failedCount += 1
            appendEvent(.init(url: url, kind: .noContent, message: nil))
            logger.info("[GoodLinksAutoFetch] No content url=\(url)")
        case .failed(let message):
            if current.state != .failed {
                itemsByLinkId[linkId] = GoodLinksAutoFetchItem(linkId: linkId, title: current.title, url: url, state: .failed, message: message, updatedAt: Date())
                completedCount += 1
            }
            failedCount += 1
            appendEvent(.init(url: url, kind: .failed, message: message))
            logger.warning("[GoodLinksAutoFetch] Failed url=\(url) error=\(message)")
        case .cancelled:
            // 取消不应阻断未来重试，因此直接移除记录
            itemsByLinkId.removeValue(forKey: linkId)
            appendEvent(.init(url: url, kind: .skipped, message: "cancelled"))
        }
        
        pumpIfNeeded()
        
        if pendingLinkIds.isEmpty, inFlightTasksByLinkId.isEmpty {
            logger.info("[GoodLinksAutoFetch] Finished pending session: total=\(itemsByLinkId.count) completed=\(completedCount) cacheHit=\(cacheHitCount) succeeded=\(succeededCount) failed=\(failedCount)")
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
    
    private func normalizeTitle(_ title: String?) -> String? {
        guard let title else { return nil }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
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
