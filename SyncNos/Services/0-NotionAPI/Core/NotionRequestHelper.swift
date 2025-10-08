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
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return data
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
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return data
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

    // MARK: - Error helpers
    /// Returns true when the given error represents a Notion 'database missing' or similar error
    /// (e.g. 400/404/410) produced by `performRequest`.
    ///
    /// This helper unwraps nested/underlying errors (when present) to make the
    /// check resilient to wrapped NSError instances.
    static func isDatabaseMissingError(_ error: Error) -> Bool {
        func checkNSError(_ ns: NSError) -> Bool {
            if ns.domain == "NotionService" {
                return ns.code == 404 || ns.code == 400 || ns.code == 410
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
        if ns.code != 400 && ns.code != 413 { return false }
        let msg = (ns.userInfo[NSLocalizedDescriptionKey] as? String)?.lowercased() ?? ""
        let keys = ["too long", "exceed", "length", "maximum", "validation", "content too large"]
        return keys.contains { msg.contains($0) }
    }

    private static func ensureSuccess(response: URLResponse, data: Data) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
        }
    }
}
