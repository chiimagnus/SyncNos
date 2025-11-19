import Foundation

enum WeReadAPIError: Error {
    case notLoggedIn
    case invalidURL
    case decodingError
    case networkError(Error)
    case serverError(Int)
}

final class WeReadAPIService {
    private let authService: WeReadAuthServiceProtocol
    private let session: URLSession
    
    init(authService: WeReadAuthServiceProtocol = WeReadAuthService.shared) {
        self.authService = authService
        let config = URLSessionConfiguration.default
        self.session = URLSession(configuration: config)
    }
    
    private func getHeaders() throws -> [String: String] {
        guard let cookie = authService.cookieString else {
            throw WeReadAPIError.notLoggedIn
        }
        return [
            "Cookie": cookie,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*"
        ]
    }
    
    private func request<T: Decodable>(url: String, method: String = "GET") async throws -> T {
        guard let urlObj = URL(string: url) else {
            throw WeReadAPIError.invalidURL
        }
        
        var request = URLRequest(url: urlObj)
        request.httpMethod = method
        let headers = try getHeaders()
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw WeReadAPIError.networkError(NSError(domain: "WeReadAPI", code: -1, userInfo: nil))
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            // Check for 401 - maybe cookie expired
            if httpResponse.statusCode == 401 {
                authService.logout()
                throw WeReadAPIError.notLoggedIn
            }
            throw WeReadAPIError.serverError(httpResponse.statusCode)
        }
        
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            print("WeRead Decode Error: \(error)")
            if let str = String(data: data, encoding: .utf8) {
                print("Response Body: \(str)")
            }
            throw WeReadAPIError.decodingError
        }
    }
    
    // MARK: - API Endpoints
    
    /// Get all notebooks (books with highlights/notes)
    func getNotebooks() async throws -> WeReadNotebookResponse {
        return try await request(url: "https://weread.qq.com/api/user/notebook")
    }
    
    /// Get book detail
    func getBookInfo(bookId: String) async throws -> WeReadBookInfo {
        // The API returns structure like { "title": ..., "author": ... } directly or wrapped?
        // Based on docs, `https://weread.qq.com/web/book/info?bookId={bookId}`
        // Let's assume it returns WeReadBookInfo directly based on typical usage, 
        // but we might need to adjust if it's wrapped.
        return try await request(url: "https://weread.qq.com/web/book/info?bookId=\(bookId)")
    }
    
    /// Get highlights
    func getBookmarks(bookId: String) async throws -> WeReadHighlightResponse {
        return try await request(url: "https://weread.qq.com/web/book/bookmarklist?bookId=\(bookId)")
    }
    
    /// Get reviews (notes)
    func getReviews(bookId: String) async throws -> WeReadReviewResponse {
        // listType=11&mine=1&synckey=0 seems standard for "my reviews"
        return try await request(url: "https://weread.qq.com/web/review/list?bookId=\(bookId)&listType=11&mine=1&synckey=0")
    }
}

