import Foundation

/// Notion API 网络请求辅助方法
class NotionRequestHelper {
    private let configStore: NotionConfigStoreProtocol
    private let apiBase: URL
    private let notionVersion: String
    private let logger: LoggerServiceProtocol

    init(configStore: NotionConfigStoreProtocol, apiBase: URL, notionVersion: String, logger: LoggerServiceProtocol) {
        self.configStore = configStore
        self.apiBase = apiBase
        self.notionVersion = notionVersion
        self.logger = logger
    }

    // MARK: - Request Helpers
    private func addCommonHeaders(to request: inout URLRequest, key: String) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue(notionVersion, forHTTPHeaderField: "Notion-Version")
    }

    // Centralized request sender to remove duplicated URLSession/request boilerplate
    func performRequest(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        addCommonHeaders(to: &request, key: key)
        if let b = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: b, options: [])
        }

        // Retry-on-rate-limit (429) with exponential backoff
        let maxAttempts = 3
        var attempt = 0
        var backoffMillis: UInt64 = 500
        while true {
            attempt += 1
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 429, attempt < maxAttempts {
                try await Task.sleep(nanoseconds: backoffMillis * 1_000_000)
                backoffMillis *= 2
                continue
            }
            try Self.ensureSuccess(response: response, data: data)
            return data
        }
    }

    // Overload that accepts a full URL (used for URLComponents-built URLs)
    func performRequest(url: URL, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        addCommonHeaders(to: &request, key: key)
        if let b = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: b, options: [])
        }
        // Retry-on-rate-limit (429) with exponential backoff
        let maxAttempts = 3
        var attempt = 0
        var backoffMillis: UInt64 = 500
        while true {
            attempt += 1
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 429, attempt < maxAttempts {
                try await Task.sleep(nanoseconds: backoffMillis * 1_000_000)
                backoffMillis *= 2
                continue
            }
            try Self.ensureSuccess(response: response, data: data)
            return data
        }
    }

    // MARK: - URL helpers
    /// Construct a full URL by appending a Notion API path to the configured apiBase.
    func makeURL(path: String) -> URL {
        return apiBase.appendingPathComponent(path)
    }

    /// Construct URLComponents for a Notion API path. Useful when adding query items.
    func makeURLComponents(path: String) -> URLComponents {
        return URLComponents(url: makeURL(path: path), resolvingAgainstBaseURL: false)!
    }

    // MARK: - Discovery helpers
    /// Returns array of data_source ids for a given database id by calling
    /// GET /v1/databases/{database_id} and extracting the `data_sources` array.
    func getDataSourceIds(forDatabaseId databaseId: String) async throws -> [String] {
        let data = try await performRequest(path: "databases/\(databaseId)", method: "GET", body: nil)
        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] ?? [:]
        let dss = json["data_sources"] as? [[String: Any]] ?? []
        let ids = dss.compactMap { $0["id"] as? String }
        if ids.isEmpty {
            logger.warning("No data_sources found for database \(databaseId)")
        } else {
            logger.debug("Discovered data_source ids for database \(databaseId): \(ids)")
        }
        return ids
    }

    /// Returns the primary data_source id for a given database id. Throws if none found.
    func getPrimaryDataSourceId(forDatabaseId databaseId: String) async throws -> String {
        let ids = try await getDataSourceIds(forDatabaseId: databaseId)
        guard let first = ids.first else {
            throw NSError(domain: "NotionService", code: -1, userInfo: [NSLocalizedDescriptionKey: "No data_source found for database \(databaseId)"])
        }
        return first
    }

    /// List children of a page/block with pagination support.
    /// Returns tuple of (results array, nextCursor)
    func listPageChildren(pageId: String, startCursor: String?, pageSize: Int = 100) async throws -> (results: [[String: Any]], nextCursor: String?) {
        var comps = makeURLComponents(path: "blocks/\(pageId)/children")
        var queryItems: [URLQueryItem] = [URLQueryItem(name: "page_size", value: "\(pageSize)")]
        if let start = startCursor { queryItems.append(URLQueryItem(name: "start_cursor", value: start)) }
        comps.queryItems = queryItems
        guard let url = comps.url else {
            throw NSError(domain: "NotionService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for listing page children"])
        }
        let data = try await performRequest(url: url, method: "GET", body: nil)
        let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] ?? [:]
        let results = json["results"] as? [[String: Any]] ?? []
        let next = json["next_cursor"] as? String
        return (results, next)
    }

    // MARK: - Error helpers
    /// Returns true when the given error represents a Notion 'database missing' or similar error
    /// (e.g. 400/404/410) produced by `performRequest`.
    ///
    /// This helper unwraps nested/underlying errors (when present) to make the
    /// check resilient to wrapped NSError instances.
    static func isDatabaseMissingError(_ error: Error) -> Bool {
        func checkNSError(_ ns: NSError) -> Bool {
            if ns.domain == "NotionService" {
                // 更精确：仅 404/410 视为缺失；避免将 400（校验失败/内容过大）误判为库缺失
                return ns.code == 404 || ns.code == 410
            }
            if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
                return checkNSError(underlying)
            }
            return false
        }

        let ns = error as NSError
        return checkNSError(ns)
    }

    /// Returns true when the given error likely indicates content size/validation overflow from Notion
    /// Heuristic: HTTP 400 or 413 with message containing certain keywords
    static func isContentTooLargeError(_ error: Error) -> Bool {
        let ns = error as NSError
        guard ns.domain == "NotionService" else { return false }
        // 413 明确表示内容/请求过大
        if ns.code == 413 { return true }
        // 400 经常用于校验失败，结合文案进行启发式判断
        if ns.code == 400 {
            let raw = (ns.userInfo[NSLocalizedDescriptionKey] as? String) ?? ""
            let msg = raw.lowercased()
            // 常见英文/中文关键字覆盖
            let keys = [
                "validation", "too long", "too_long", "content too large", "payload too large", "exceed", "exceeds", "length", "maximum", "max length", "over maximum", "limit",
                "过长", "超出", "长度", "超过最大", "验证失败", "内容太长", "过大", "超大", "超出限制"
            ]
            if keys.contains(where: { msg.contains($0) }) { return true }
        }
        return false
    }

    private static func ensureSuccess(response: URLResponse, data: Data) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
        }
    }
}
