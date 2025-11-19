import Foundation

/// WeRead API 客户端实现，基于 Cookie 认证与 URLSession
final class WeReadAPIService: WeReadAPIServiceProtocol {
    private let authService: WeReadAuthServiceProtocol
    private let logger: LoggerServiceProtocol

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
        return try decodeBookmarks(from: data, bookId: bookId)
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
        return try decodeReviews(from: data, bookId: bookId)
    }

    // MARK: - Low level request

    private func performRequest(url: URL) async throws -> Data {
        guard let cookie = authService.cookieHeader, !cookie.isEmpty else {
            throw NSError(
                domain: "WeReadAPI",
                code: 401,
                userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("WeRead is not logged in. Please login first.", comment: "")]
            )
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
            throw NSError(domain: "WeReadAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response"])
        }

        guard 200..<300 ~= http.statusCode else {
            let bodyPreview = String(data: data.prefix(256), encoding: .utf8) ?? ""
            logger.error("[WeReadAPI] HTTP \(http.statusCode) for \(url.absoluteString), body=\(bodyPreview)")
            if http.statusCode == 401 {
                throw NSError(domain: "WeReadAPI", code: 401, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("WeRead cookie expired or invalid. Please login again.", comment: "")])
            } else {
                throw NSError(domain: "WeReadAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "WeRead HTTP error \(http.statusCode)"])
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

        // 先尝试直接解码为数组
        if let direct = try? decoder.decode([WeReadBookmark].self, from: data) {
            return direct
        }

        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        guard let root = json else { return [] }

        let candidatesKeys = ["bookmarks", "items", "list"]
        for key in candidatesKeys {
            if let arr = root[key] {
                let subData = try JSONSerialization.data(withJSONObject: arr, options: [])
                if let decoded = try? decoder.decode([WeReadBookmark].self, from: subData) {
                    return decoded
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
}


