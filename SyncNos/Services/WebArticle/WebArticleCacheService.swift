import Foundation
import SwiftData

// MARK: - Web Article Cache Model Container Factory

/// URL 网页文章缓存专用 ModelContainer 工厂
enum WebArticleCacheModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedWebArticle.self
        ])

        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("web_article_cache.store")

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

/// URL 网页文章抓取缓存服务（SwiftData）
@ModelActor
actor WebArticleCacheService: WebArticleCacheServiceProtocol {
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }

    // MARK: - Read

    func getArticle(url: String) throws -> ArticleFetchResult? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let targetURL = trimmed
        let predicate = #Predicate<CachedWebArticle> { item in
            item.url == targetURL
        }
        var descriptor = FetchDescriptor<CachedWebArticle>(predicate: predicate)
        descriptor.fetchLimit = 1

        guard let cached = try modelContext.fetch(descriptor).first else {
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
        let predicate = #Predicate<CachedWebArticle> { item in
            item.url == targetURL
        }
        var descriptor = FetchDescriptor<CachedWebArticle>(predicate: predicate)
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
            let newItem = CachedWebArticle(
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
        logger.debug("[WebArticleCache] Upserted url=\(targetURL)")
    }

    // MARK: - Cleanup

    func removeExpiredArticles() throws {
        // 已取消过期机制：文章缓存为持久化存储，不再按时间自动淘汰
        return
    }

    func removeAll() throws {
        let all = try modelContext.fetch(FetchDescriptor<CachedWebArticle>())
        for item in all {
            modelContext.delete(item)
        }
        try modelContext.save()
        logger.info("[WebArticleCache] Removed all cached articles: \(all.count)")
    }
}
