import Foundation
import AppKit

// MARK: - GoodLinks URL Fetcher Protocol

protocol GoodLinksURLFetcherProtocol: AnyObject, Sendable {
    func fetchArticle(url: String) async throws -> ArticleFetchResult
    func fetchArticleWithAuth(url: String, cookies: [HTTPCookie]) async throws -> ArticleFetchResult
}

// MARK: - GoodLinks URL Fetcher

/// GoodLinks URL Only 文章抓取器
///
/// 说明：
/// - 仅负责从 URL 获取网页并做“轻量”正文提取（优先 `<article>` / `<main>`）
/// - 纯文本提取使用 `NSAttributedString` HTML 转换，便于 Notion 同步与搜索
final class GoodLinksURLFetcher: GoodLinksURLFetcherProtocol {
    private let logger: LoggerServiceProtocol
    private let session: URLSession
    
    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        session: URLSession = .shared
    ) {
        self.logger = logger
        self.session = session
    }
    
    func fetchArticle(url: String) async throws -> ArticleFetchResult {
        try await fetchArticleInternal(url: url, cookieHeader: nil, source: .url)
    }
    
    func fetchArticleWithAuth(url: String, cookies: [HTTPCookie]) async throws -> ArticleFetchResult {
        let headerFields = HTTPCookie.requestHeaderFields(with: cookies)
        let cookieHeader = headerFields["Cookie"]
        return try await fetchArticleInternal(url: url, cookieHeader: cookieHeader, source: .urlWithAuth)
    }
    
    // MARK: - Internal
    
    private func fetchArticleInternal(url raw: String, cookieHeader: String?, source: FetchSource) async throws -> ArticleFetchResult {
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
        
        let startTime = Date()
        do {
            let (data, response) = try await session.data(for: request)
            let duration = Date().timeIntervalSince(startTime)
            logger.info("[GoodLinksURLFetcher] 请求完成 \(String(format: "%.2f", duration))s url=\(raw)")
            
            guard let http = response as? HTTPURLResponse else {
                throw URLFetchError.invalidResponse
            }
            
            switch http.statusCode {
            case 200:
                break
            case 401, 403:
                throw URLFetchError.authenticationRequired
            case 429:
                throw URLFetchError.rateLimited
            default:
                throw URLFetchError.httpStatus(http.statusCode)
            }
            
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
        } catch let error as URLFetchError {
            throw error
        } catch {
            throw URLFetchError.networkError(error)
        }
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
        // 支持 <meta property="og:title" content="..."> / 单引号 / 属性顺序变化
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
    
    // MARK: - Constants
    
    private static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
}

