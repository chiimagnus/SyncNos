import Foundation

/// Dedao API 客户端实现，基于 Cookie 认证与 URLSession
final class DedaoAPIService: DedaoAPIServiceProtocol {
    private let authService: DedaoAuthServiceProtocol
    private let logger: LoggerServiceProtocol
    
    /// Dedao Web 端基础 URL
    private let baseURL = URL(string: "https://www.dedao.cn")!
    
    /// 请求间隔控制（防止触发反爬）
    private var lastRequestTime: Date = .distantPast
    private let minRequestInterval: TimeInterval = 1.0  // 最小请求间隔 1 秒
    
    /// 每页数量
    private let pageSize = 18
    
    init(
        authService: DedaoAuthServiceProtocol,
        logger: LoggerServiceProtocol
    ) {
        self.authService = authService
        self.logger = logger
    }
    
    // MARK: - Public API
    
    /// 获取用户书架中的电子书列表（单页）
    func fetchEbooks(page: Int) async throws -> [DedaoEbook] {
        let url = baseURL.appendingPathComponent("/api/hades/v2/product/list")
        
        let body: [String: Any] = [
            "category": "ebook",
            "display_group": true,
            "filter": "all",
            "group_id": 0,
            "order": "study",
            "filter_complete": 0,
            "page": page,
            "page_size": pageSize,
            "sort_type": "desc"
        ]
        
        let data = try await performPostRequest(url: url, body: body)
        let response = try decodeResponse(DedaoEbookListResponse.self, from: data)
        
        logger.info("[DedaoAPI] Fetched ebooks page \(page): \(response.list.count) items")
        return response.list
    }
    
    /// 获取所有电子书（自动分页）
    func fetchAllEbooks() async throws -> [DedaoEbook] {
        var allEbooks: [DedaoEbook] = []
        var currentPage = 1
        var hasMore = true
        
        while hasMore {
            let ebooks = try await fetchEbooks(page: currentPage)
            allEbooks.append(contentsOf: ebooks)
            
            // 如果返回的数量少于 pageSize，说明没有更多数据了
            hasMore = ebooks.count >= pageSize
            currentPage += 1
            
            // 防止无限循环
            if currentPage > 100 {
                logger.warning("[DedaoAPI] Reached max page limit (100) when fetching ebooks")
                break
            }
        }
        
        logger.info("[DedaoAPI] Fetched all ebooks: \(allEbooks.count) total")
        return allEbooks
    }
    
    /// 获取指定电子书的笔记列表
    /// 自动过滤掉无效笔记（空内容、非电子书类型等）
    func fetchEbookNotes(ebookEnid: String) async throws -> [DedaoEbookNote] {
        let url = baseURL.appendingPathComponent("/api/pc/ledgers/ebook/list")
        
        let body: [String: Any] = [
            "book_enid": ebookEnid
        ]
        
        let data = try await performPostRequest(url: url, body: body)
        let response = try decodeResponse(DedaoEbookNotesResponse.self, from: data)
        
        // 过滤有效的电子书笔记（有实际划线内容或用户备注）
        let validNotes = response.list.filter { note in
            // 必须是自己的笔记（isFromMe == 1）或未指定
            let isOwnNote = (note.isFromMe ?? 1) == 1
            // 必须有实际内容
            let hasContent = note.isValidEbookNote
            return isOwnNote && hasContent
        }
        
        logger.info("[DedaoAPI] Fetched notes for ebook \(ebookEnid): \(response.list.count) total, \(validNotes.count) valid")
        return validNotes
    }
    
    /// 获取用户信息
    func fetchUserInfo() async throws -> DedaoUserInfo {
        let url = baseURL.appendingPathComponent("/api/pc/user/info")
        
        let data = try await performGetRequest(url: url)
        let userInfo = try decodeResponse(DedaoUserInfo.self, from: data)
        
        logger.info("[DedaoAPI] Fetched user info: \(userInfo.nickname)")
        return userInfo
    }
    
    /// 生成二维码用于扫码登录
    func generateQRCode() async throws -> DedaoQRCodeResponse {
        // 第一步：获取 Access Token
        let accessTokenURL = baseURL.appendingPathComponent("/loginapi/getAccessToken")
        let accessTokenData = try await performPostRequest(url: accessTokenURL, body: [:], requiresAuth: false)
        
        guard let json = try? JSONSerialization.jsonObject(with: accessTokenData) as? [String: Any],
              let accessToken = json["accessToken"] as? String else {
            throw DedaoAPIError.invalidResponse
        }
        
        // 第二步：获取二维码
        let qrCodeURL = baseURL.appendingPathComponent("/oauth/api/embedded/qrcode")
        var request = URLRequest(url: qrCodeURL)
        request.httpMethod = "GET"
        request.setValue(accessToken, forHTTPHeaderField: "X-Oauth-Access-Token")
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw DedaoAPIError.invalidResponse
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let qrCodeResponse = try decoder.decode(DedaoQRCodeResponse.self, from: data)
        
        logger.info("[DedaoAPI] Generated QR code, expires in \(qrCodeResponse.expire) seconds")
        return qrCodeResponse
    }
    
    /// 检查二维码登录状态
    func checkQRCodeLogin(qrCodeString: String) async throws -> DedaoCheckLoginResponse {
        // 需要先获取 Access Token
        let accessTokenURL = baseURL.appendingPathComponent("/loginapi/getAccessToken")
        let accessTokenData = try await performPostRequest(url: accessTokenURL, body: [:], requiresAuth: false)
        
        guard let json = try? JSONSerialization.jsonObject(with: accessTokenData) as? [String: Any],
              let accessToken = json["accessToken"] as? String else {
            throw DedaoAPIError.invalidResponse
        }
        
        // 检查登录状态
        let checkURL = baseURL.appendingPathComponent("/oauth/api/embedded/qrcode/check_login")
        var request = URLRequest(url: checkURL)
        request.httpMethod = "POST"
        request.setValue(accessToken, forHTTPHeaderField: "X-Oauth-Access-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        
        let body: [String: Any] = [
            "keepLogin": true,
            "pname": "igetoauthpc",
            "qrCode": qrCodeString,
            "scene": "registerlogin"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw DedaoAPIError.invalidResponse
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let checkResponse = try decoder.decode(DedaoCheckLoginResponse.self, from: data)
        
        logger.info("[DedaoAPI] QR code login status: \(checkResponse.status)")
        return checkResponse
    }
    
    // MARK: - Private Request Methods
    
    private var userAgent: String {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36"
    }
    
    private func performGetRequest(url: URL) async throws -> Data {
        try await waitForNextRequest()
        
        guard let cookie = authService.cookieHeader, !cookie.isEmpty else {
            throw DedaoAPIError.notLoggedIn
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        
        logger.debug("[DedaoAPI] GET: \(url.absoluteString)")
        return try await executeRequest(request)
    }
    
    private func performPostRequest(url: URL, body: [String: Any], requiresAuth: Bool = true) async throws -> Data {
        try await waitForNextRequest()
        
        if requiresAuth {
            guard let cookie = authService.cookieHeader, !cookie.isEmpty else {
                throw DedaoAPIError.notLoggedIn
            }
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        
        if requiresAuth, let cookie = authService.cookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
            
            // 提取 CSRF Token（如果存在）
            if let csrfToken = extractCSRFToken(from: cookie) {
                request.setValue(csrfToken, forHTTPHeaderField: "Xi-Csrf-Token")
                request.setValue("web", forHTTPHeaderField: "Xi-DT")
            }
        }
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        logger.debug("[DedaoAPI] POST: \(url.absoluteString)")
        return try await executeRequest(request)
    }
    
    private func executeRequest(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        
        lastRequestTime = Date()
        
        guard let http = response as? HTTPURLResponse else {
            throw DedaoAPIError.invalidResponse
        }
        
        // 处理 HTTP 错误
        guard 200..<300 ~= http.statusCode else {
            let bodyPreview = String(data: data.prefix(256), encoding: .utf8) ?? ""
            logger.error("[DedaoAPI] HTTP \(http.statusCode) for \(request.url?.absoluteString ?? "unknown"), body=\(bodyPreview)")
            
            switch http.statusCode {
            case 401:
                throw DedaoAPIError.sessionExpired
            case 403:
                throw DedaoAPIError.needVerification
            case 429:
                throw DedaoAPIError.rateLimited
            case 496:
                // 496 NoCertificate - 需要图形验证码
                throw DedaoAPIError.needVerification
            default:
                throw DedaoAPIError.serverError(code: http.statusCode, message: bodyPreview)
            }
        }
        
        return data
    }
    
    /// 请求间隔控制
    private func waitForNextRequest() async throws {
        let timeSinceLastRequest = Date().timeIntervalSince(lastRequestTime)
        if timeSinceLastRequest < minRequestInterval {
            let waitTime = minRequestInterval - timeSinceLastRequest
            try await Task.sleep(nanoseconds: UInt64(waitTime * 1_000_000_000))
        }
    }
    
    /// 从 Cookie 中提取 CSRF Token
    private func extractCSRFToken(from cookie: String) -> String? {
        let pairs = cookie.components(separatedBy: ";")
        for pair in pairs {
            let trimmed = pair.trimmingCharacters(in: .whitespaces)
            if trimmed.lowercased().hasPrefix("csrftoken=") {
                return String(trimmed.dropFirst("csrftoken=".count))
            }
        }
        return nil
    }
    
    // MARK: - Decoding Helpers
    
    /// 解码得到 API 的通用响应格式
    private func decodeResponse<T: Codable>(_ type: T.Type, from data: Data) throws -> T {
        // 打印原始响应（调试用）
        if let rawString = String(data: data, encoding: .utf8) {
            logger.debug("[DedaoAPI] Raw response preview: \(String(rawString.prefix(500)))")
        }
        
        // 先检查响应头的错误码
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let header = json["h"] as? [String: Any],
           let code = header["c"] as? Int {
            if code != 0 {
                let message = header["e"] as? String ?? "Unknown error"
                logger.warning("[DedaoAPI] API error: \(code) - \(message)")
                
                // 特定错误码处理
                if code == -1 || code == 401 {
                    throw DedaoAPIError.sessionExpired
                }
                throw DedaoAPIError.serverError(code: code, message: message)
            }
        }
        
        // 尝试从 "c" 字段解码实际数据
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let content = json["c"] {
            let contentData = try JSONSerialization.data(withJSONObject: content)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            do {
                return try decoder.decode(T.self, from: contentData)
            } catch {
                // 打印详细的解码错误
                logger.error("[DedaoAPI] Decode error for \(T.self): \(error)")
                if let contentString = String(data: contentData, encoding: .utf8) {
                    logger.error("[DedaoAPI] Content that failed to decode: \(String(contentString.prefix(1000)))")
                }
                throw error
            }
        }
        
        // 兜底：尝试直接解码
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            logger.error("[DedaoAPI] Direct decode error for \(T.self): \(error)")
            throw error
        }
    }
}

