import Foundation
import AppKit

// MARK: - Web Article Fetcher Protocol

protocol WebArticleFetcherProtocol: AnyObject, Sendable {
    func fetchArticle(url: String) async throws -> ArticleFetchResult
}

// MARK: - Web Article Fetcher

/// URL Only 文章抓取器
///
/// 说明：
/// - 仅负责从 URL 获取网页并做“轻量”正文提取（优先 `<article>` / `<main>`）
/// - 纯文本提取使用 `NSAttributedString` HTML 转换，便于 Notion 同步与搜索
final class WebArticleFetcher: WebArticleFetcherProtocol {
    private let logger: LoggerServiceProtocol
    private let session: URLSession
    private let cacheService: WebArticleCacheServiceProtocol?
    private let siteLoginsStore: SiteLoginsStoreProtocol?
    private let telemetry = Telemetry()

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        session: URLSession = .shared,
        cacheService: WebArticleCacheServiceProtocol? = nil,
        siteLoginsStore: SiteLoginsStoreProtocol? = nil
    ) {
        self.logger = logger
        self.session = session
        self.cacheService = cacheService
        self.siteLoginsStore = siteLoginsStore
    }

    func fetchArticle(url: String) async throws -> ArticleFetchResult {
        let config = Config.load(userDefaults: .standard)
        await telemetry.recordCall()

        if config.enableCache, let cacheService {
            do {
                if let cached = try await cacheService.getArticle(url: url) {
                    await telemetry.recordCacheHit()
                    if let snapshot = await telemetry.snapshotIfNeeded(every: config.aggregateLogEvery) {
                        logTelemetrySnapshot(snapshot)
                    }
                    logger.info("[WebArticleFetcher] 命中缓存 url=\(url)")
                    return cached
                } else {
                    await telemetry.recordCacheMiss()
                }
            } catch {
                await telemetry.recordCacheMiss()
                logger.warning("[WebArticleFetcher] 读取缓存失败 url=\(url) error=\(error.localizedDescription)")
            }
        }

        if config.enableCookieAuth, let siteLoginsStore {
            let cookieHeader = await siteLoginsStore.getCookieHeader(for: url)
            if let cookieHeader, !cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                do {
                    let result = try await fetchArticleInternal(
                        url: url,
                        cookieHeader: cookieHeader,
                        source: .urlWithAuth,
                        config: config
                    )
                    await telemetry.recordSuccess(source: .urlWithAuth)
                    if let snapshot = await telemetry.snapshotIfNeeded(every: config.aggregateLogEvery) {
                        logTelemetrySnapshot(snapshot)
                    }
                    return result
                } catch {
                    await telemetry.recordFailure(error: error)
                    if let snapshot = await telemetry.snapshotIfNeeded(every: config.aggregateLogEvery) {
                        logTelemetrySnapshot(snapshot)
                    }
                    throw error
                }
            }
        }

        do {
            let result = try await fetchArticleInternal(url: url, cookieHeader: nil, source: .url, config: config)
            await telemetry.recordSuccess(source: .url)
            if let snapshot = await telemetry.snapshotIfNeeded(every: config.aggregateLogEvery) {
                logTelemetrySnapshot(snapshot)
            }
            return result
        } catch {
            await telemetry.recordFailure(error: error)
            if let snapshot = await telemetry.snapshotIfNeeded(every: config.aggregateLogEvery) {
                logTelemetrySnapshot(snapshot)
            }
            throw error
        }
    }

    // MARK: - Internal

    private func fetchArticleInternal(
        url raw: String,
        cookieHeader: String?,
        source: FetchSource,
        config: Config
    ) async throws -> ArticleFetchResult {
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            throw URLFetchError.invalidURL(raw)
        }

        var request = URLRequest(url: url)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
        if let cookieHeader, !cookieHeader.isEmpty {
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }

        let data = try await fetchDataWithRetry(request: request, rawURL: raw, config: config)
        let result = try parseArticleFromHTMLData(data, source: source)

        if config.enableCache, let cacheService {
            do {
                try await cacheService.upsertArticle(url: raw, result: result)
            } catch {
                logger.warning("[WebArticleFetcher] 写入缓存失败 url=\(raw) error=\(error.localizedDescription)")
            }
        }

        return result
    }

    // MARK: - Decode / Extract / Transform

    private func decodeHTML(_ data: Data) -> String? {
        if let utf8 = String(data: data, encoding: .utf8) { return utf8 }
        if let latin1 = String(data: data, encoding: .isoLatin1) { return latin1 }
        return String(decoding: data, as: UTF8.self)
    }

    private func sanitizeHTML(_ html: String) -> String {
        var result = html
        // 移除脚本与样式，降低噪声
        result = result.replacingOccurrences(
            of: "<script\\b[^>]*>[\\s\\S]*?<\\/script>",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        result = result.replacingOccurrences(
            of: "<style\\b[^>]*>[\\s\\S]*?<\\/style>",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        return result
    }

    private func extractTitle(from html: String) -> String? {
        extractTag(html, tagName: "title")
            ?? extractMetaContent(html, key: "property", value: "og:title")
            ?? extractMetaContent(html, key: "name", value: "twitter:title")
    }

    private func extractAuthor(from html: String) -> String? {
        extractMetaContent(html, key: "name", value: "author")
            ?? extractMetaContent(html, key: "property", value: "article:author")
    }

    private func extractMainContent(from html: String) -> String {
        // 优先使用语义容器，尽量不要返回整页
        if let article = extractTagBlock(html, tagName: "article") { return article }
        if let main = extractTagBlock(html, tagName: "main") { return main }
        if let body = extractTagBlock(html, tagName: "body") { return body }
        return html
    }

    private func extractTag(_ html: String, tagName: String) -> String? {
        let pattern = "<\(tagName)\\b[^>]*>([\\s\\S]*?)<\\/\(tagName)>"
        return firstCapture(html, pattern: pattern)?
            .replacingOccurrences(of: "\\s+", with: " ", options: [.regularExpression])
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func extractTagBlock(_ html: String, tagName: String) -> String? {
        let pattern = "<\(tagName)\\b[^>]*>([\\s\\S]*?)<\\/\(tagName)>"
        guard let inner = firstCapture(html, pattern: pattern) else { return nil }
        let trimmed = inner.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // 包装成最小 HTML，便于后续 HTML -> 文本
        return "<html><body>\(trimmed)</body></html>"
    }

    private func extractMetaContent(_ html: String, key: String, value: String) -> String? {
        // 支持 <meta property=\"og:title\" content=\"...\"> / 单引号 / 属性顺序变化
        let escapedValue = NSRegularExpression.escapedPattern(for: value)
        let pattern = "<meta\\b[^>]*\\b\(key)\\s*=\\s*['\\\"]\(escapedValue)['\\\"][^>]*\\bcontent\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"][^>]*>"
        return firstCapture(html, pattern: pattern)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func firstCapture(_ text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges >= 2,
              let r = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    private func htmlToPlainText(_ html: String) -> String {
        guard let data = html.data(using: .utf8) else { return "" }
        do {
            let attributed = try NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue
                ],
                documentAttributes: nil
            )
            return attributed.string
        } catch {
            // Fallback: 粗暴去标签（避免完全无内容）
            return html
                .replacingOccurrences(of: "<[^>]+>", with: " ", options: [.regularExpression])
        }
    }

    private func countWords(in text: String) -> Int {
        var count = 0
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: [.byWords, .localized]) { _, _, _, _ in
            count += 1
        }
        return count
    }

    // MARK: - Retry / Telemetry / Config

    private func fetchDataWithRetry(request: URLRequest, rawURL: String, config: Config) async throws -> Data {
        let maxAttempts = config.enableRetry ? max(1, config.maxRetries + 1) : 1
        var lastError: Error?

        for attemptIndex in 1...maxAttempts {
            await telemetry.recordAttempt()
            let startTime = Date()

            do {
                let (data, response) = try await session.data(for: request)
                let duration = Date().timeIntervalSince(startTime)
                logger.info("[WebArticleFetcher] 请求完成 \(String(format: "%.2f", duration))s url=\(rawURL)")

                guard let http = response as? HTTPURLResponse else {
                    throw URLFetchError.invalidResponse
                }

                switch http.statusCode {
                case 200:
                    return data
                case 401, 403:
                    throw URLFetchError.authenticationRequired
                case 429:
                    throw URLFetchError.rateLimited
                default:
                    throw URLFetchError.httpStatus(http.statusCode)
                }
            } catch {
                let normalized = normalizeError(error)
                lastError = normalized

                let shouldRetry = config.enableRetry
                    && attemptIndex < maxAttempts
                    && shouldRetryError(normalized)

                if shouldRetry {
                    await telemetry.recordRetry()
                    let backoff = computeBackoffSeconds(
                        attemptIndex: attemptIndex,
                        initialSeconds: config.initialBackoffSeconds,
                        maxSeconds: config.maxBackoffSeconds
                    )
                    logger.warning("[WebArticleFetcher] 抓取失败，重试 \(attemptIndex)/\(maxAttempts - 1) in \(String(format: "%.2f", backoff))s url=\(rawURL) error=\(String(describing: normalized))")
                    try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
                    continue
                }

                throw normalized
            }
        }

        throw lastError ?? URLFetchError.invalidResponse
    }

    private func normalizeError(_ error: Error) -> Error {
        if let fetchError = error as? URLFetchError { return fetchError }
        return URLFetchError.networkError(error)
    }

    private func shouldRetryError(_ error: Error) -> Bool {
        guard let fetchError = error as? URLFetchError else { return false }
        switch fetchError {
        case .rateLimited:
            return true
        case .invalidResponse:
            return true
        case .httpStatus(let code):
            // 408 / 5xx 认为是短暂性错误
            return code == 408 || (500...599).contains(code)
        case .networkError(let underlying):
            return isTransientNetworkError(underlying)
        case .invalidURL, .authenticationRequired, .decodingFailed, .parsingFailed, .contentNotFound:
            return false
        }
    }

    private func isTransientNetworkError(_ underlying: Error) -> Bool {
        let urlError: URLError?
        if let e = underlying as? URLError {
            urlError = e
        } else if let e = (underlying as NSError?)?.domain == NSURLErrorDomain ? URLError(_nsError: underlying as NSError) : nil {
            urlError = e
        } else {
            urlError = nil
        }

        guard let urlError else { return false }
        switch urlError.code {
        case .timedOut,
             .cannotFindHost,
             .cannotConnectToHost,
             .networkConnectionLost,
             .dnsLookupFailed,
             .notConnectedToInternet,
             .resourceUnavailable,
             .cannotLoadFromNetwork,
             .dataNotAllowed,
             .secureConnectionFailed,
             .cannotParseResponse:
            return true
        default:
            return false
        }
    }

    private func computeBackoffSeconds(attemptIndex: Int, initialSeconds: Double, maxSeconds: Double) -> Double {
        // attemptIndex 从 1 开始；第 1 次失败后的等待使用 initialSeconds
        let exponent = Double(max(0, attemptIndex - 1))
        let base = initialSeconds * pow(2.0, exponent)
        let capped = min(base, maxSeconds)
        let jitter = Double.random(in: 0...(capped * 0.25))
        return capped + jitter
    }

    private func parseArticleFromHTMLData(_ data: Data, source: FetchSource) throws -> ArticleFetchResult {
        guard let html = decodeHTML(data) else {
            throw URLFetchError.decodingFailed
        }

        let cleaned = sanitizeHTML(html)
        let title = extractTitle(from: cleaned)
        let author = extractAuthor(from: cleaned)
        let mainHTML = extractMainContent(from: cleaned)

        guard !mainHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw URLFetchError.contentNotFound
        }

        let text = htmlToPlainText(mainHTML).trimmingCharacters(in: .whitespacesAndNewlines)
        let wordCount = countWords(in: text)

        return ArticleFetchResult(
            title: title,
            content: mainHTML,
            textContent: text,
            author: author,
            publishedDate: nil,
            wordCount: wordCount,
            fetchedAt: Date(),
            source: source
        )
    }

    private func logTelemetrySnapshot(_ snapshot: Telemetry.Snapshot) {
        let cacheTotal = snapshot.cacheHits + snapshot.cacheMisses
        let cacheHitRate: Double = cacheTotal == 0 ? 0 : (Double(snapshot.cacheHits) / Double(cacheTotal))

        logger.info(
            "[WebArticleFetcher] 统计 calls=\(snapshot.totalCalls) " +
            "cacheHit=\(snapshot.cacheHits) cacheMiss=\(snapshot.cacheMisses) hitRate=\(String(format: "%.0f%%", cacheHitRate * 100)) " +
            "attempts=\(snapshot.attempts) retries=\(snapshot.retries) " +
            "success=\(snapshot.successes) fail=\(snapshot.failures) " +
            "successBySource=\(snapshot.successesBySource) " +
            "failByKind=\(snapshot.failuresByKind)"
        )
    }

    private struct Config: Sendable {
        let enableCache: Bool
        let enableCookieAuth: Bool
        let enableRetry: Bool
        let maxRetries: Int
        let initialBackoffSeconds: Double
        let maxBackoffSeconds: Double
        let aggregateLogEvery: Int

        static func load(userDefaults: UserDefaults) -> Config {
            let enableCache = (userDefaults.object(forKey: DefaultsKeys.enableCache) as? Bool) ?? true
            let enableCookieAuth = (userDefaults.object(forKey: DefaultsKeys.enableCookieAuth) as? Bool) ?? true
            let enableRetry = (userDefaults.object(forKey: DefaultsKeys.enableRetry) as? Bool) ?? true

            let maxRetries = clamp(
                Int(userDefaults.object(forKey: DefaultsKeys.maxRetries) as? Int ?? 2),
                min: 0,
                max: 10
            )

            let initialBackoffSeconds = max(0.1, userDefaults.object(forKey: DefaultsKeys.initialBackoffSeconds) as? Double ?? 1.0)
            let maxBackoffSeconds = max(initialBackoffSeconds, userDefaults.object(forKey: DefaultsKeys.maxBackoffSeconds) as? Double ?? 8.0)
            let aggregateLogEvery = max(1, userDefaults.object(forKey: DefaultsKeys.aggregateLogEvery) as? Int ?? 20)

            return Config(
                enableCache: enableCache,
                enableCookieAuth: enableCookieAuth,
                enableRetry: enableRetry,
                maxRetries: maxRetries,
                initialBackoffSeconds: initialBackoffSeconds,
                maxBackoffSeconds: maxBackoffSeconds,
                aggregateLogEvery: aggregateLogEvery
            )
        }

        private static func clamp(_ value: Int, min: Int, max: Int) -> Int {
            Swift.max(min, Swift.min(max, value))
        }
    }

    enum DefaultsKeys {
        // 保留历史 key 字符串，避免用户设置丢失（之前由 GoodLinksURLFetcher 定义）
        static let enableCache = "goodlinks.urlFetcher.enableCache"
        static let enableCookieAuth = "goodlinks.urlFetcher.enableCookieAuth"
        static let enableRetry = "goodlinks.urlFetcher.enableRetry"
        static let maxRetries = "goodlinks.urlFetcher.maxRetries"
        static let initialBackoffSeconds = "goodlinks.urlFetcher.initialBackoffSeconds"
        static let maxBackoffSeconds = "goodlinks.urlFetcher.maxBackoffSeconds"
        static let aggregateLogEvery = "goodlinks.urlFetcher.aggregateLogEvery"
    }

    private actor Telemetry {
        struct Snapshot: Sendable {
            let totalCalls: Int
            let cacheHits: Int
            let cacheMisses: Int
            let attempts: Int
            let retries: Int
            let successes: Int
            let failures: Int
            let successesBySource: [String: Int]
            let failuresByKind: [String: Int]
        }

        private var totalCalls: Int = 0
        private var cacheHits: Int = 0
        private var cacheMisses: Int = 0
        private var attempts: Int = 0
        private var retries: Int = 0
        private var successes: Int = 0
        private var failures: Int = 0
        private var successesBySource: [String: Int] = [:]
        private var failuresByKind: [String: Int] = [:]

        func recordCall() {
            totalCalls += 1
        }

        func recordCacheHit() {
            cacheHits += 1
        }

        func recordCacheMiss() {
            cacheMisses += 1
        }

        func recordAttempt() {
            attempts += 1
        }

        func recordRetry() {
            retries += 1
        }

        func recordSuccess(source: FetchSource) {
            successes += 1
            let key = source.rawValue
            successesBySource[key, default: 0] += 1
        }

        func recordFailure(error: Error) {
            failures += 1
            let key = failureKind(from: error)
            failuresByKind[key, default: 0] += 1
        }

        func snapshotIfNeeded(every: Int) -> Snapshot? {
            guard every > 0 else { return nil }
            guard totalCalls > 0, totalCalls % every == 0 else { return nil }
            return Snapshot(
                totalCalls: totalCalls,
                cacheHits: cacheHits,
                cacheMisses: cacheMisses,
                attempts: attempts,
                retries: retries,
                successes: successes,
                failures: failures,
                successesBySource: successesBySource,
                failuresByKind: failuresByKind
            )
        }

        private func failureKind(from error: Error) -> String {
            if let e = error as? URLFetchError {
                switch e {
                case .invalidURL:
                    return "invalidURL"
                case .invalidResponse:
                    return "invalidResponse"
                case .httpStatus(let code):
                    return "httpStatus:\(code)"
                case .authenticationRequired:
                    return "authenticationRequired"
                case .rateLimited:
                    return "rateLimited"
                case .decodingFailed:
                    return "decodingFailed"
                case .parsingFailed:
                    return "parsingFailed"
                case .contentNotFound:
                    return "contentNotFound"
                case .networkError(let underlying):
                    if let urlError = underlying as? URLError {
                        return "urlError:\(urlError.code.rawValue)"
                    }
                    return "networkError"
                }
            }
            return "unknown"
        }
    }

    // MARK: - Constants

    private static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
}

