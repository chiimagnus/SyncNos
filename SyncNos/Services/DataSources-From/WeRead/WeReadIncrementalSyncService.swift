import Foundation

// MARK: - Sync Result

/// 同步结果枚举
enum WeReadSyncResult {
    case noChanges
    case updated(added: Int, removed: Int)
    case fullSyncRequired
}

// MARK: - WeRead Incremental Sync Service

/// WeRead 增量同步服务
/// 负责协调 API 和缓存之间的增量同步
final class WeReadIncrementalSyncService {
    private let apiService: WeReadAPIServiceProtocol
    private let cacheService: WeReadCacheServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        apiService: WeReadAPIServiceProtocol,
        cacheService: WeReadCacheServiceProtocol,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.apiService = apiService
        self.cacheService = cacheService
        self.logger = logger
    }
    
    // MARK: - Notebook Sync
    
    /// 同步书籍列表（增量）
    /// - Returns: 同步结果
    @MainActor
    func syncNotebooks() async throws -> WeReadSyncResult {
        // 1. 获取本地 synckey
        let state = try await cacheService.getSyncState()
        let localSyncKey = state.notebookSyncKey ?? 0
        
        logger.info("[WeReadSync] Starting notebook sync with syncKey: \(localSyncKey)")
        
        // 2. 调用增量 API
        let response = try await apiService.fetchNotebooksIncremental(syncKey: localSyncKey)
        
        // 3. 如果 synckey 相同且无更新，无需处理
        if response.syncKey == localSyncKey && response.updated.isEmpty && (response.removed?.isEmpty ?? true) {
            logger.info("[WeReadSync] Notebooks up to date, no changes")
            return .noChanges
        }
        
        // 4. 保存新增/更新的书籍
        if !response.updated.isEmpty {
            try await cacheService.saveBooks(response.updated)
            logger.info("[WeReadSync] Saved \(response.updated.count) updated books")
        }
        
        // 5. 删除已移除的书籍
        if let removed = response.removed, !removed.isEmpty {
            try await cacheService.deleteBooks(ids: removed)
            logger.info("[WeReadSync] Deleted \(removed.count) removed books")
        }
        
        // 6. 更新 synckey
        try await cacheService.updateSyncState(
            notebookSyncKey: response.syncKey,
            lastSyncAt: Date()
        )
        
        return .updated(
            added: response.updated.count,
            removed: response.removed?.count ?? 0
        )
    }
    
    // MARK: - Highlight Sync
    
    /// 同步单本书的高亮（增量）
    /// - Parameter bookId: 书籍 ID
    /// - Returns: 同步结果
    @MainActor
    func syncHighlights(bookId: String) async throws -> WeReadSyncResult {
        // 1. 获取本地 synckey
        let localSyncKey = try await cacheService.getBookSyncKey(bookId: bookId) ?? 0
        
        logger.info("[WeReadSync] Starting highlight sync for bookId=\(bookId) with syncKey: \(localSyncKey)")
        
        // 2. 调用增量 API
        let response = try await apiService.fetchBookmarksIncremental(bookId: bookId, syncKey: localSyncKey)
        
        // 3. 如果 synckey 相同且无更新，无需处理
        if response.syncKey == localSyncKey && response.updated.isEmpty && (response.removed?.isEmpty ?? true) {
            logger.info("[WeReadSync] Highlights for bookId=\(bookId) up to date")
            return .noChanges
        }
        
        // 4. 获取想法并合并（如果有新高亮）
        var mergedBookmarks = response.updated
        if !response.updated.isEmpty {
            // 获取想法
            let reviews = try await apiService.fetchReviews(bookId: bookId)
            
            // 合并想法到高亮
            mergedBookmarks = mergeHighlightsWithReviews(
                bookmarks: response.updated,
                reviews: reviews
            )
        }
        
        // 5. 保存新增/更新的高亮
        if !mergedBookmarks.isEmpty {
            try await cacheService.saveHighlights(mergedBookmarks, bookId: bookId)
            logger.info("[WeReadSync] Saved \(mergedBookmarks.count) highlights for bookId=\(bookId)")
        }
        
        // 6. 删除已移除的高亮
        if let removed = response.removed, !removed.isEmpty {
            try await cacheService.deleteHighlights(ids: removed)
            logger.info("[WeReadSync] Deleted \(removed.count) highlights for bookId=\(bookId)")
        }
        
        // 7. 更新 synckey 和高亮数量
        try await cacheService.updateBookSyncKey(bookId: bookId, syncKey: response.syncKey)
        
        // 重新计算高亮数量
        let allHighlights = try await cacheService.getHighlights(bookId: bookId)
        try await cacheService.updateBookHighlightCount(bookId: bookId, count: allHighlights.count)
        
        return .updated(
            added: mergedBookmarks.count,
            removed: response.removed?.count ?? 0
        )
    }
    
    // MARK: - Full Sync
    
    /// 全量同步所有数据（首次使用或缓存损坏时）
    @MainActor
    func fullSync(progress: ((String) -> Void)? = nil) async throws {
        logger.info("[WeReadSync] Starting full sync...")
        progress?(NSLocalizedString("Fetching book list...", comment: ""))
        
        // 1. 获取所有书籍
        let notebooks = try await apiService.fetchNotebooks()
        try await cacheService.saveBooks(notebooks)
        
        logger.info("[WeReadSync] Saved \(notebooks.count) books")
        progress?(String(format: NSLocalizedString("Found %d books, fetching highlights...", comment: ""), notebooks.count))
        
        // 2. 并发获取每本书的高亮
        let total = notebooks.count
        var completed = 0
        
        await withTaskGroup(of: Void.self) { group in
            for notebook in notebooks {
                group.addTask { [weak self] in
                    guard let self else { return }
                    do {
                        // 获取合并后的高亮
                        let mergedHighlights = try await self.apiService.fetchMergedHighlights(bookId: notebook.bookId)
                        
                        // 保存到缓存
                        try await self.cacheService.saveHighlights(mergedHighlights, bookId: notebook.bookId)
                        try await self.cacheService.updateBookHighlightCount(bookId: notebook.bookId, count: mergedHighlights.count)
                        
                        // 更新进度
                        await MainActor.run {
                            completed += 1
                            progress?(String(format: NSLocalizedString("Syncing highlights: %d/%d", comment: ""), completed, total))
                        }
                    } catch {
                        self.logger.warning("[WeReadSync] Failed to sync highlights for bookId=\(notebook.bookId): \(error.localizedDescription)")
                    }
                }
            }
        }
        
        // 3. 更新全局同步状态
        let state = try await cacheService.getSyncState()
        state.lastFullSyncAt = Date()
        try await cacheService.updateSyncState(notebookSyncKey: nil, lastSyncAt: Date())
        
        logger.info("[WeReadSync] Full sync completed")
        progress?(NSLocalizedString("Sync completed", comment: ""))
    }
    
    // MARK: - Private Helpers
    
    /// 将高亮与想法基于 range 字段合并
    private func mergeHighlightsWithReviews(
        bookmarks: [WeReadBookmark],
        reviews: [WeReadReview]
    ) -> [WeReadBookmark] {
        // 构建 range -> [review] 映射
        var reviewsByRange: [String: [WeReadReview]] = [:]
        for review in reviews {
            if review.type == 1, let range = review.range, !range.isEmpty {
                let normalizedRange = range.trimmingCharacters(in: .whitespaces)
                if !normalizedRange.isEmpty {
                    reviewsByRange[normalizedRange, default: []].append(review)
                }
            }
        }
        
        // 合并
        return bookmarks.map { bookmark in
            var merged = bookmark
            if let range = bookmark.range, !range.isEmpty {
                let normalizedRange = range.trimmingCharacters(in: .whitespaces)
                if let matchedReviews = reviewsByRange[normalizedRange], !matchedReviews.isEmpty {
                    let reviewContents = matchedReviews.map { $0.content }
                    merged = WeReadBookmark(
                        highlightId: bookmark.highlightId,
                        bookId: bookmark.bookId,
                        chapterTitle: bookmark.chapterTitle,
                        colorIndex: bookmark.colorIndex,
                        text: bookmark.text,
                        note: bookmark.note,
                        timestamp: bookmark.timestamp,
                        reviewContents: reviewContents,
                        range: bookmark.range
                    )
                }
            }
            return merged
        }
    }
}

