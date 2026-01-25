import Foundation

// MARK: - Web Article Fetcher Protocol

protocol WebArticleFetcherProtocol: AnyObject, Sendable {
    func fetchArticle(url: String) async throws -> ArticleFetchResult
}

// MARK: - Web Article Fetcher

/// URL 网页文章抓取器（成功率优先）
///
/// 说明：
/// - 统一使用离屏 WKWebView 渲染后抽取正文（支持 SPA / 动态注入）
/// - 抓取结果写入 `WebArticleCacheService` 做持久化复用（Detail/Notion 共用）
final class WebArticleFetcher: WebArticleFetcherProtocol, @unchecked Sendable {
    private let logger: LoggerServiceProtocol
    private let cacheService: WebArticleCacheServiceProtocol?
    private let siteLoginsStore: SiteLoginsStoreProtocol?
    private let extractor: WebArticleWebKitExtractorProtocol

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        cacheService: WebArticleCacheServiceProtocol? = nil,
        siteLoginsStore: SiteLoginsStoreProtocol? = nil,
        extractor: WebArticleWebKitExtractorProtocol = WebArticleWebKitExtractor()
    ) {
        self.logger = logger
        self.cacheService = cacheService
        self.siteLoginsStore = siteLoginsStore
        self.extractor = extractor
    }

    func fetchArticle(url: String) async throws -> ArticleFetchResult {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw URLFetchError.invalidURL(url)
        }

        if let cacheService {
            do {
                if let cached = try await cacheService.getArticle(url: trimmed) {
                    logger.info("[WebArticleFetcher] 命中缓存 url=\(trimmed)")
                    return cached
                }
            } catch {
                logger.warning("[WebArticleFetcher] 读取缓存失败 url=\(trimmed) error=\(error.localizedDescription)")
            }
        }

        guard let targetURL = URL(string: trimmed),
              let scheme = targetURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            throw URLFetchError.invalidURL(url)
        }

        // NOTE: cookieHeader 当前只用于兼容既有的 SiteLoginsStore（未来可扩展为 WebKit 登录态复用）。
        let headerFromStore: String?
        if let siteLoginsStore {
            headerFromStore = await siteLoginsStore.getCookieHeader(for: trimmed)
        } else {
            headerFromStore = nil
        }

        let source: FetchSource = (headerFromStore?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ? .urlWithAuth : .url

        let extracted = try await extractor.extractArticle(url: targetURL, cookieHeader: headerFromStore)
        let text = extracted.textContent.trimmingCharacters(in: .whitespacesAndNewlines)
        let wordCount = countWords(in: text)

        let result = ArticleFetchResult(
            title: extracted.title,
            content: extracted.contentHTML,
            textContent: text,
            author: extracted.author,
            publishedDate: nil,
            wordCount: wordCount,
            fetchedAt: Date(),
            source: source
        )

        if let cacheService {
            do {
                try await cacheService.upsertArticle(url: trimmed, result: result)
            } catch {
                logger.warning("[WebArticleFetcher] 写入缓存失败 url=\(trimmed) error=\(error.localizedDescription)")
            }
        }

        return result
    }

    private func countWords(in text: String) -> Int {
        var count = 0
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: [.byWords, .localized]) { _, _, _, _ in
            count += 1
        }
        return count
    }
}
