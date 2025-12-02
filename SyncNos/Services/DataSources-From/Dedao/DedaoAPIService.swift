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
    /// - Returns: 元组包含书籍列表、总数和是否有更多
    private func fetchEbooksPage(page: Int) async throws -> (list: [DedaoEbook], total: Int?, hasMore: Bool) {
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
        
        // 更智能的分页判断：
        // 1. 优先使用 isMore 字段（如果存在且为 1）
        // 2. 否则根据本页数量判断（如果本页满 pageSize，则可能有更多）
        let hasMore: Bool
        if let isMore = response.isMore {
            hasMore = (isMore == 1)
        } else {
            // 如果 isMore 不存在，根据本页数量判断
            hasMore = (response.list.count >= pageSize)
        }
        
        logger.info("[DedaoAPI] Fetched ebooks page \(page): \(response.list.count) items, total=\(response.total ?? -1), isMore=\(response.isMore ?? -1), hasMore=\(hasMore)")
        return (response.list, response.total, hasMore)
    }
    
    /// 获取用户书架中的电子书列表（单页）- 兼容旧接口
    func fetchEbooks(page: Int) async throws -> [DedaoEbook] {
        let (list, _, _) = try await fetchEbooksPage(page: page)
        return list
    }
    
    /// 获取电子书总数
    /// 通过调用首页分类 API 获取电子书架中的电子书数量
    func fetchEbookCount() async throws -> Int {
        let url = baseURL.appendingPathComponent("/api/hades/v1/index/detail")
        
        let data = try await performPostRequest(url: url, body: [:])
        let response = try decodeResponse(DedaoCategoryListResponse.self, from: data)
        
        // 查找电子书分类（注意：响应嵌套在 data 字段中）
        if let ebookCategory = response.data.list.first(where: { $0.category == "ebook" }) {
            logger.info("[DedaoAPI] Ebook count from index: \(ebookCategory.count)")
            return ebookCategory.count
        }
        
        logger.warning("[DedaoAPI] Ebook category not found in index response")
        return 0
    }
    
    /// 获取所有电子书（自动分页）
    func fetchAllEbooks() async throws -> [DedaoEbook] {
        // 方法1：先获取电子书总数，然后计算需要多少页
        let totalCount = try await fetchEbookCount()
        guard totalCount > 0 else {
            logger.info("[DedaoAPI] No ebooks in bookshelf")
            return []
        }
        
        let totalPages = Int(ceil(Double(totalCount) / Double(pageSize)))
        logger.info("[DedaoAPI] Will fetch \(totalPages) pages for \(totalCount) ebooks (pageSize=\(pageSize))")
        
        var allEbooks: [DedaoEbook] = []
        
        for page in 1...totalPages {
            let (ebooks, _, _) = try await fetchEbooksPage(page: page)
            allEbooks.append(contentsOf: ebooks)
            
            logger.debug("[DedaoAPI] Progress: \(allEbooks.count)/\(totalCount) ebooks fetched")
            
            // 如果返回为空，提前结束
            if ebooks.isEmpty {
                logger.warning("[DedaoAPI] Page \(page) returned empty, stopping early")
                break
            }
            
            // 已经获取足够数量，可以提前停止
            if allEbooks.count >= totalCount {
                break
            }
        }
        
        logger.info("[DedaoAPI] Fetched all ebooks: \(allEbooks.count) total (expected: \(totalCount))")
        return allEbooks
    }
    
    /// 获取指定电子书的笔记列表
    /// 自动过滤掉无效笔记（空内容、非电子书类型等）
    /// - Parameters:
    ///   - ebookEnid: 电子书加密 ID
    ///   - bookTitle: 书名（可选，用于日志记录）
    func fetchEbookNotes(ebookEnid: String, bookTitle: String? = nil) async throws -> [DedaoEbookNote] {
        let url = baseURL.appendingPathComponent("/api/pc/ledgers/ebook/list")
        
        let body: [String: Any] = [
            "book_enid": ebookEnid
        ]
        
        let data = try await performPostRequest(url: url, body: body)
        
        // 调试：打印原始响应的第一条笔记结构
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let content = json["c"] as? [String: Any],
           let list = content["list"] as? [[String: Any]],
           let first = list.first {
            let displayName = bookTitle ?? ebookEnid
            logger.warning("[DedaoAPI] Raw note structure for \"\(displayName)\": \(first.keys.sorted())")
            // 打印第一条笔记的部分字段
            let sampleFields = first.filter { ["note_line", "note", "note_id_str", "is_from_me", "text", "content", "mark_text", "underline_text"].contains($0.key) }
            logger.warning("[DedaoAPI] Sample fields: \(sampleFields)")
        }
        
        let response = try decodeResponse(DedaoEbookNotesResponse.self, from: data)
        
        // 过滤有效的电子书笔记（有实际划线内容或用户备注）
        // 注意：不再根据 is_from_me 过滤，因为 API 返回的值可能不准确
        // 调试：打印前几个被过滤掉的笔记信息
        var filteredOutCount = 0
        var filteredOutSamples: [String] = []
        
        let validNotes = response.list.filter { note in
            // 只根据内容判断，不过滤 is_from_me
            let hasContent = note.isValidEbookNote
            
            // 调试：记录被过滤掉的笔记
            if !hasContent {
                filteredOutCount += 1
                if filteredOutSamples.count < 3 {
                    let sample = "noteId=\(note.noteIdStr ?? "nil"), isFromMe=\(note.isFromMe ?? -1), noteLine='\(note.noteLine?.prefix(50) ?? "nil")', note='\(note.note?.prefix(30) ?? "nil")', highlights=\(note.highlights?.count ?? 0)"
                    filteredOutSamples.append(sample)
                }
            }
            
            return hasContent
        }
        
        // 日志中优先显示书名，否则显示 ID
        let displayName = bookTitle ?? ebookEnid
        logger.info("[DedaoAPI] Fetched notes for \"\(displayName)\": \(response.list.count) total, \(validNotes.count) valid, \(filteredOutCount) filtered out")
        
        // 如果有大量笔记被过滤，输出样本以供调试
        if filteredOutCount > 0 && filteredOutSamples.count > 0 {
            logger.warning("[DedaoAPI] Filtered out samples: \(filteredOutSamples.joined(separator: " | "))")
        }
        
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

