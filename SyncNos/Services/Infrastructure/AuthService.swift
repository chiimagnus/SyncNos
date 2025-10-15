import Foundation

final class AuthService: AuthServiceProtocol {
    private struct BackendConfig {
        static var baseURL: URL {
            // 允许通过 UserDefaults 覆盖（方便调试）
            if let override = UserDefaults.standard.string(forKey: "BackendBaseURL"), let url = URL(string: override) {
                return url
            }
            return URL(string: "http://127.0.0.1:8000/api/v1")!
        }
    }

    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    // MARK: - Public API
    func loginWithApple(authorizationCode: String, nonce: String? = nil) async throws -> AuthTokens {
        let url = BackendConfig.baseURL.appending(path: "auth/login/apple")
        var payload: [String: Any] = ["authorization_code": authorizationCode]
        if let nonce { payload["nonce"] = nonce }
        return try await postJSON(url: url, body: payload)
    }

    func refresh(refreshToken: String) async throws -> AuthTokens {
        let url = BackendConfig.baseURL.appending(path: "auth/refresh")
        let payload = ["refresh_token": refreshToken]
        return try await postJSON(url: url, body: payload)
    }

    func logout(refreshToken: String) async throws {
        let url = BackendConfig.baseURL.appending(path: "auth/logout")
        let payload = ["refresh_token": refreshToken]
        _ = try await postForVoid(url: url, body: payload)
    }

    func fetchProfile(accessToken: String) async throws -> AccountProfile {
        let url = BackendConfig.baseURL.appending(path: "users/profile")
        return try await getJSON(url: url, accessToken: accessToken)
    }

    func fetchLoginMethods(accessToken: String) async throws -> [LoginMethod] {
        struct MethodsEnvelope: Decodable { let data: [LoginMethod] }
        let url = BackendConfig.baseURL.appending(path: "users/login-methods")
        let envelope: MethodsEnvelope = try await getJSON(url: url, accessToken: accessToken)
        return envelope.data
    }

    func deleteAccount(accessToken: String) async throws {
        let url = BackendConfig.baseURL.appending(path: "users/me")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await urlSession.data(for: request)
        try Self.validateHTTP(response: resp, data: data)
    }

    // MARK: - Helpers
    private func getJSON<T: Decodable>(url: URL, accessToken: String?) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, resp) = try await urlSession.data(for: request)
        try Self.validateHTTP(response: resp, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func postJSON<T: Decodable>(url: URL, body: [String: Any]) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, resp) = try await urlSession.data(for: request)
        try Self.validateHTTP(response: resp, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func postForVoid(url: URL, body: [String: Any]) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, resp) = try await urlSession.data(for: request)
        try Self.validateHTTP(response: resp, data: data)
    }

    private static func validateHTTP(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "<no body>"
            throw NSError(domain: "AuthService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: body])
        }
    }
}


