import Foundation

// MARK: - WeRead API Errors

enum WeReadAPIError: LocalizedError {
    case notLoggedIn
    case unauthorized
    case sessionExpired
    case sessionExpiredWithRefreshFailure(reason: String)
    case invalidResponse
    case httpError(statusCode: Int, body: String)
    case apiError(code: Int, message: String)
    
    var errorDescription: String? {
        switch self {
        case .notLoggedIn:
            return NSLocalizedString("WeRead is not logged in. Please login first.", comment: "")
        case .unauthorized:
            return NSLocalizedString("WeRead cookie expired or invalid. Please login again.", comment: "")
        case .sessionExpired:
            return NSLocalizedString("WeRead session expired. Please login again.", comment: "")
        case .sessionExpiredWithRefreshFailure(let reason):
            return String(format: NSLocalizedString("WeRead session expired and auto-refresh failed: %@. Please login manually.", comment: ""), reason)
        case .invalidResponse:
            return NSLocalizedString("Invalid HTTP response from WeRead.", comment: "")
        case .httpError(let statusCode, _):
            return NSLocalizedString("WeRead HTTP error \(statusCode)", comment: "")
        case .apiError(let code, let message):
            return "WeRead API error \(code): \(message)"
        }
    }
    
    var isAuthenticationError: Bool {
        switch self {
        case .notLoggedIn, .unauthorized, .sessionExpired:
            return true
        default:
            return false
        }
    }
}

/// WeRead API 客户端实现，基于 Cookie 认证与 URLSession
final class WeReadAPIService: WeReadAPIServiceProtocol {
    private let authService: WeReadAuthServiceProtocol
    private let logger: LoggerServiceProtocol
    private let refreshCoordinator = CookieRefreshCoordinator()

    /// WeRead Web 端基础 URL
    private let baseURL = URL(string: "https://weread.qq.com")!

    init(
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.logger = logger
    }

    // MARK: - Public API

    func fetchNotebooks() async throws -> [WeReadNotebook] {
        let url = baseURL.appendingPathComponent("/api/user/notebook")
        let data = try await performRequest(url: url)
        // WeRead 返回的 JSON 结构可能为 { "books": [ ... ] } 或 { "notebooks": [ ... ] }
        let decoded = try decodeNotebookList(from: data)
        logger.info("[WeReadAPI] fetched notebooks: \(decoded.count)")
        return decoded
    }

    func fetchBookInfo(bookId: String) async throws -> WeReadBookInfo {
        var components = URLComponents(url: baseURL.appendingPathComponent("/web/book/info"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "bookId", value: bookId)]
        let data = try await performRequest(url: components.url!)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys
        return try decoder.decode(WeReadBookInfo.self, from: data)
    }

    func fetchBookmarks(bookId: String) async throws -> [WeReadBookmark] {
        var components = URLComponents(url: baseURL.appendingPathComponent("/web/book/bookmarklist"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "bookId", value: bookId)]
        let data = try await performRequest(url: components.url!)
        let bookmarks = try decodeBookmarks(from: data, bookId: bookId)
        logger.info("[WeReadAPI] fetched bookmarks for bookId=\(bookId): \(bookmarks.count)")
        return bookmarks
    }

    func fetchReviews(bookId: String) async throws -> [WeReadReview] {
        var components = URLComponents(url: baseURL.appendingPathComponent("/web/review/list"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "bookId", value: bookId),
            URLQueryItem(name: "listType", value: "11"),
            URLQueryItem(name: "mine", value: "1"),
            URLQueryItem(name: "synckey", value: "0")
        ]
        let data = try await performRequest(url: components.url!)
        let reviews = try decodeReviews(from: data, bookId: bookId)
        logger.info("[WeReadAPI] fetched reviews for bookId=\(bookId): \(reviews.count)")
        return reviews
    }

    // MARK: - Low level request

    private func performRequest(url: URL) async throws -> Data {
        do {
            return try await executeRequest(url: url)
        } catch let error as WeReadAPIError where error.isAuthenticationError {
            // 检测到认证错误，尝试刷新 Cookie 并重试
            return try await handleAuthenticationError(url: url, originalError: error)
        }
    }
    
    /// 处理认证错误：刷新 Cookie 并重试
    private func handleAuthenticationError(url: URL, originalError: Error) async throws -> Data {
        logger.info("[WeReadAPI] Authentication error detected, attempting cookie refresh...")
        
        do {
            // 在 MainActor 上创建 WeReadCookieRefreshService
            let refreshService = await MainActor.run {
                WeReadCookieRefreshService(
                    authService: authService,
                    logger: logger
                )
            }
            
            // 通过 actor 协调刷新
            _ = try await refreshCoordinator.attemptRefresh(
                refreshService: refreshService,
                authService: authService
            )
            
            logger.info("[WeReadAPI] Cookie refreshed successfully, retrying request")
            
            // 重试原始请求
            return try await executeRequest(url: url)
        } catch {
            logger.error("[WeReadAPI] Cookie refresh failed: \(error.localizedDescription)")
            
            // 清除过期的 Cookie
            await authService.clearCookies()
            
            // 抛出包含刷新失败信息的错误
            throw WeReadAPIError.sessionExpiredWithRefreshFailure(
                reason: error.localizedDescription
            )
        }
    }
    
    /// 实际执行 HTTP 请求
    private func executeRequest(url: URL) async throws -> Data {
        guard let cookie = authService.cookieHeader, !cookie.isEmpty else {
            throw WeReadAPIError.notLoggedIn
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20

        logger.debug("[WeReadAPI] Request: \(url.absoluteString)")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw WeReadAPIError.invalidResponse
        }

        guard 200..<300 ~= http.statusCode else {
            let bodyPreview = String(data: data.prefix(256), encoding: .utf8) ?? ""
            logger.error("[WeReadAPI] HTTP \(http.statusCode) for \(url.absoluteString), body=\(bodyPreview)")
            
            if http.statusCode == 401 {
                throw WeReadAPIError.unauthorized
            } else {
                throw WeReadAPIError.httpError(statusCode: http.statusCode, body: bodyPreview)
            }
        }

        // 检查响应体中的错误码（微信读书特有的错误格式）
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let errCode = json["errCode"] as? Int {
            if errCode == -2012 {
                logger.warning("[WeReadAPI] Session expired (errCode: -2012)")
                throw WeReadAPIError.sessionExpired
            } else if errCode != 0 {
                let errMsg = json["errMsg"] as? String ?? "Unknown error"
                logger.warning("[WeReadAPI] API error: \(errCode) - \(errMsg)")
                throw WeReadAPIError.apiError(code: errCode, message: errMsg)
            }
        }

        return data
    }

    // MARK: - Decoding helpers

    private func decodeNotebookList(from data: Data) throws -> [WeReadNotebook] {
        // 先尝试直接解码为数组
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys

        if let direct = try? decoder.decode([WeReadNotebook].self, from: data) {
            return direct
        }

        // 再尝试包裹在字典中
        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        guard let root = json else { return [] }

        let candidatesKeys = ["books", "notebooks", "items"]
        for key in candidatesKeys {
            if let arr = root[key] {
                let subData = try JSONSerialization.data(withJSONObject: arr, options: [])
                if let decoded = try? decoder.decode([WeReadNotebook].self, from: subData) {
                    return decoded
                }
            }
        }

        // 如果结构完全不匹配，则返回空列表但记录日志
        let preview = String(data: data.prefix(256), encoding: .utf8) ?? ""
        logger.warning("[WeReadAPI] Unable to decode notebooks list. Raw preview: \(preview)")
        return []
    }

    private func decodeBookmarks(from data: Data, bookId: String) throws -> [WeReadBookmark] {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys

        // 优先按 HighlightResponse（obsidian-weread-plugin 的 HighlightResponse）解码
        if let resp = try? decoder.decode(WeReadHighlightResponse.self, from: data) {
            // 构建 chapterUid -> title 映射，便于展示章节标题
            var chapterTitleByUid: [Int: String] = [:]
            if let chapters = resp.chapters {
                for ch in chapters {
                    if let uid = ch.chapterUid {
                        chapterTitleByUid[uid] = ch.title
                    }
                }
            }

            return resp.updated.map { item in
                let rawId = item.bookmarkId
                // 与插件一致：将 bookmarkId 中的 "_"、"~" 替换为 "-"，避免在下游（如块引用）中出问题
                let normalizedId = rawId.replacingOccurrences(
                    of: #"[_~]"#,
                    with: "-",
                    options: .regularExpression
                )
                let chapterTitle: String?
                if let uid = item.chapterUid, let title = chapterTitleByUid[uid] {
                    chapterTitle = title
                } else {
                    chapterTitle = item.chapterName
                }

                // WeRead API 返回的颜色值是 1-5，需要转换为 0-4 的索引
                let colorIndex = (item.colorStyle ?? item.style).map { $0 - 1 }
                
                return WeReadBookmark(
                    highlightId: normalizedId,
                    bookId: item.bookId,
                    chapterTitle: chapterTitle,
                    colorIndex: colorIndex,
                    text: item.markText,
                    note: nil,
                    timestamp: item.createTime,
                    reviewContents: [],
                    range: item.range
                )
            }
        }

        // 兼容性兜底：历史或未预期结构（尽量不走到这里）
        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        guard let root = json else { return [] }

        let candidatesKeys = ["updated", "bookmarks", "items", "list"]
        for key in candidatesKeys {
            if let arr = root[key] as? [[String: Any]] {
                // 尝试从每个元素中手动抽取最低限度字段
                var result: [WeReadBookmark] = []
                result.reserveCapacity(arr.count)
                for obj in arr {
                    guard let markText = obj["markText"] as? String ?? obj["content"] as? String else {
                        continue
                    }
                    let rawId = (obj["bookmarkId"] as? String) ?? UUID().uuidString
                    let normalizedId = rawId.replacingOccurrences(
                        of: #"[_~]"#,
                        with: "-",
                        options: .regularExpression
                    )
                    let chapterTitle = (obj["chapterTitle"] as? String)
                        ?? (obj["chapterName"] as? String)
                    let rawColor = (obj["colorStyle"] as? Int) ?? (obj["color"] as? Int) ?? (obj["style"] as? Int)
                    // WeRead API 返回的颜色值是 1-5，需要转换为 0-4 的索引
                    let color = rawColor.map { $0 - 1 }
                    let ts = (obj["createTime"] as? TimeInterval)
                    let bId = (obj["bookId"] as? String) ?? bookId

                    let range = obj["range"] as? String
                    result.append(
                        WeReadBookmark(
                            highlightId: normalizedId,
                            bookId: bId,
                            chapterTitle: chapterTitle,
                            colorIndex: color,
                            text: markText,
                            note: nil,
                            timestamp: ts,
                            reviewContents: [],
                            range: range
                        )
                    )
                }
                if !result.isEmpty {
                    return result
                }
            }
        }

        let preview = String(data: data.prefix(256), encoding: .utf8) ?? ""
        logger.warning("[WeReadAPI] Unable to decode bookmarks for bookId=\(bookId). Raw preview: \(preview)")
        return []
    }

    private func decodeReviews(from data: Data, bookId: String) throws -> [WeReadReview] {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys

        if let direct = try? decoder.decode([WeReadReview].self, from: data) {
            return direct
        }

        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        guard let root = json else { return [] }

        let candidatesKeys = ["reviews", "items", "list"]
        for key in candidatesKeys {
            if let arr = root[key] {
                let subData = try JSONSerialization.data(withJSONObject: arr, options: [])
                if let decoded = try? decoder.decode([WeReadReview].self, from: subData) {
                    return decoded
                }
            }
        }

        let preview = String(data: data.prefix(256), encoding: .utf8) ?? ""
        logger.warning("[WeReadAPI] Unable to decode reviews for bookId=\(bookId). Raw preview: \(preview)")
        return []
    }

    // MARK: - Highlight Merging

    /// 获取书籍的高亮并与想法合并
    /// - Parameter bookId: 书籍 ID
    /// - Returns: 合并后的高亮列表（包含关联的想法内容）
    func fetchMergedHighlights(bookId: String) async throws -> [WeReadBookmark] {
        // 并发获取 bookmarks 和 reviews
        async let bookmarksTask = fetchBookmarks(bookId: bookId)
        async let reviewsTask = fetchReviews(bookId: bookId)
        
        let (bookmarks, reviews) = try await (bookmarksTask, reviewsTask)
        
        // 合并逻辑
        let merged = mergeHighlightsWithReviews(bookmarks: bookmarks, reviews: reviews)
        logger.info("[WeReadAPI] merged highlights for bookId=\(bookId): \(merged.count) (from \(bookmarks.count) bookmarks + \(reviews.count) reviews)")
        return merged
    }
    
    /// 将高亮与想法基于 range 字段合并
    /// - Parameters:
    ///   - bookmarks: 高亮列表
    ///   - reviews: 想法列表
    /// - Returns: 合并后的高亮列表
    private func mergeHighlightsWithReviews(
        bookmarks: [WeReadBookmark],
        reviews: [WeReadReview]
    ) -> [WeReadBookmark] {
        // 构建 range -> [review] 映射（支持一条高亮对应多条想法）
        var reviewsByRange: [String: [WeReadReview]] = [:]
        for review in reviews {
            // 只处理 type == 1 的章节级想法（type == 4 是书评，独立处理）
            if review.type == 1, let range = review.range, !range.isEmpty {
                // 标准化 range 字符串（去除空格）
                let normalizedRange = range.trimmingCharacters(in: .whitespaces)
                if !normalizedRange.isEmpty {
                    reviewsByRange[normalizedRange, default: []].append(review)
                }
            }
        }
        
        // 记录有多条想法的高亮
        let multiReviewRanges = reviewsByRange.filter { $0.value.count > 1 }
        if !multiReviewRanges.isEmpty {
            logger.info("[WeReadAPI] Found \(multiReviewRanges.count) highlights with multiple reviews")
        }
        
        // 合并
        return bookmarks.map { bookmark in
            var merged = bookmark
            if let range = bookmark.range, !range.isEmpty {
                let normalizedRange = range.trimmingCharacters(in: .whitespaces)
                if let matchedReviews = reviewsByRange[normalizedRange], !matchedReviews.isEmpty {
                    // 提取所有想法的内容
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
