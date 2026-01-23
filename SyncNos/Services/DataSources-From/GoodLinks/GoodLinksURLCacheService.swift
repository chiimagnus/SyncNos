import Foundation
import SwiftData

// MARK: - GoodLinks URL Model Container Factory

/// GoodLinks URL 缓存专用 ModelContainer 工厂
enum GoodLinksURLCacheModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedGoodLinksArticle.self
        ])
        
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("goodlinks_url_cache.store")
        
        let directory = storeURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            url: storeURL,
            allowsSave: true
        )
        
        return try ModelContainer(
            for: schema,
            configurations: [modelConfiguration]
        )
    }
}

// MARK: - Cache Service

/// GoodLinks URL 抓取缓存服务（SwiftData）
@ModelActor
actor GoodLinksURLCacheService: GoodLinksURLCacheServiceProtocol {
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    private var cacheExpiration: TimeInterval {
        3600 * 24 * 7 // 7 天
    }
    
    // MARK: - Read
    
    func getArticle(url: String) throws -> ArticleFetchResult? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        
        let targetURL = trimmed
        let predicate = #Predicate<CachedGoodLinksArticle> { item in
            item.url == targetURL
        }
        var descriptor = FetchDescriptor<CachedGoodLinksArticle>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let cached = try modelContext.fetch(descriptor).first else {
            return nil
        }
        
        if isExpired(cached.cachedAt) {
            modelContext.delete(cached)
            try modelContext.save()
            logger.debug("[GoodLinksURLCache] Cache expired, deleted url=\(targetURL)")
            return nil
        }
        
        return ArticleFetchResult(
            title: cached.title,
            content: cached.contentHTML,
            textContent: cached.textContent,
            author: cached.author,
            publishedDate: nil,
            wordCount: cached.wordCount,
            fetchedAt: cached.fetchedAt,
            source: .url
        )
    }
    
    // MARK: - Write
    
    func upsertArticle(url: String, result: ArticleFetchResult) throws {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        
        let targetURL = trimmed
        let predicate = #Predicate<CachedGoodLinksArticle> { item in
            item.url == targetURL
        }
        var descriptor = FetchDescriptor<CachedGoodLinksArticle>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let existing = try modelContext.fetch(descriptor).first {
            existing.title = result.title
            existing.author = result.author
            existing.contentHTML = result.content
            existing.textContent = result.textContent
            existing.wordCount = result.wordCount
            existing.fetchedAt = result.fetchedAt
            existing.cachedAt = Date()
        } else {
            let newItem = CachedGoodLinksArticle(
                url: targetURL,
                title: result.title,
                author: result.author,
                contentHTML: result.content,
                textContent: result.textContent,
                wordCount: result.wordCount,
                fetchedAt: result.fetchedAt,
                cachedAt: Date()
            )
            modelContext.insert(newItem)
        }
        
        try modelContext.save()
        logger.debug("[GoodLinksURLCache] Upserted url=\(targetURL)")
    }
    
    // MARK: - Cleanup
    
    func removeExpiredArticles() throws {
        let all = try modelContext.fetch(FetchDescriptor<CachedGoodLinksArticle>())
        guard !all.isEmpty else { return }
        
        var deleted = 0
        for item in all where isExpired(item.cachedAt) {
            modelContext.delete(item)
            deleted += 1
        }
        
        if deleted > 0 {
            try modelContext.save()
            logger.info("[GoodLinksURLCache] Removed expired articles: \(deleted)")
        }
    }
    
    func removeAll() throws {
        let all = try modelContext.fetch(FetchDescriptor<CachedGoodLinksArticle>())
        for item in all {
            modelContext.delete(item)
        }
        try modelContext.save()
        logger.info("[GoodLinksURLCache] Removed all cached articles: \(all.count)")
    }
    
    // MARK: - Helpers
    
    private func isExpired(_ cachedAt: Date) -> Bool {
        Date().timeIntervalSince(cachedAt) > cacheExpiration
    }
}
