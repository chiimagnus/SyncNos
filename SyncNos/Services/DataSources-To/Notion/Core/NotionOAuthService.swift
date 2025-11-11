import Foundation
import AuthenticationServices

/// Notion OAuth 服务，处理 OAuth 2.0 授权流程
@MainActor
final class NotionOAuthService {
    // Notion OAuth 配置
    // 注意：这些值需要在 Notion 开发者中心创建 Public Integration 后配置
    // 暂时使用占位符，实际使用时需要替换为真实的 Client ID 和 Client Secret
    static let clientId = "YOUR_CLIENT_ID" // TODO: 替换为实际的 Client ID
    static let clientSecret = "YOUR_CLIENT_SECRET" // TODO: 替换为实际的 Client Secret
    static let redirectURI = "syncnos://oauth/callback"
    
    // Notion OAuth 端点
    private static let authorizationURL = "https://api.notion.com/v1/oauth/authorize"
    private static let tokenURL = "https://api.notion.com/v1/oauth/token"
    
    private let logger: LoggerServiceProtocol
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    /// 启动 OAuth 授权流程
    /// - Returns: 授权码（code）或 nil（如果用户取消）
    func startAuthorization() async throws -> String? {
        guard Self.clientId != "YOUR_CLIENT_ID" else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Notion OAuth Client ID not configured"]
            )
        }
        
        // 生成 state 参数用于防止 CSRF 攻击
        let state = UUID().uuidString
        
        // 构建授权 URL
        var components = URLComponents(string: Self.authorizationURL)!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: Self.clientId),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "owner", value: "user"),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "state", value: state)
        ]
        
        guard let authURL = components.url else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create authorization URL"]
            )
        }
        
        logger.info("Starting Notion OAuth authorization: \(authURL.absoluteString)")
        
        // 使用 ASWebAuthenticationSession 处理 OAuth 流程
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "syncnos"
            ) { callbackURL, error in
                if let error = error {
                    let nsError = error as NSError
                    // 用户取消授权（code == -1000）
                    if nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(returning: nil)
                        return
                    }
                    continuation.resume(throwing: error)
                    return
                }
                
                guard let callbackURL = callbackURL else {
                    continuation.resume(throwing: NSError(
                        domain: "NotionOAuthService",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "No callback URL received"]
                    ))
                    return
                }
                
                // 解析回调 URL，提取 code 和 state
                guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      let queryItems = components.queryItems else {
                    continuation.resume(throwing: NSError(
                        domain: "NotionOAuthService",
                        code: 4,
                        userInfo: [NSLocalizedDescriptionKey: "Invalid callback URL"]
                    ))
                    return
                }
                
                // 验证 state
                let receivedState = queryItems.first(where: { $0.name == "state" })?.value
                guard receivedState == state else {
                    continuation.resume(throwing: NSError(
                        domain: "NotionOAuthService",
                        code: 5,
                        userInfo: [NSLocalizedDescriptionKey: "State mismatch - possible CSRF attack"]
                    ))
                    return
                }
                
                // 提取授权码
                guard let code = queryItems.first(where: { $0.name == "code" })?.value else {
                    // 检查是否有错误
                    if let error = queryItems.first(where: { $0.name == "error" })?.value {
                        continuation.resume(throwing: NSError(
                            domain: "NotionOAuthService",
                            code: 6,
                            userInfo: [NSLocalizedDescriptionKey: "OAuth error: \(error)"]
                        ))
                    } else {
                        continuation.resume(throwing: NSError(
                            domain: "NotionOAuthService",
                            code: 7,
                            userInfo: [NSLocalizedDescriptionKey: "No authorization code in callback"]
                        ))
                    }
                    return
                }
                
                continuation.resume(returning: code)
            }
            
            // macOS 需要设置 presentationContextProvider
            session.presentationContextProvider = OAuthPresentationContextProvider.shared
            
            // 启动会话
            session.start()
        }
    }
    
    /// 使用授权码交换访问令牌
    /// - Parameter code: 授权码
    /// - Returns: 访问令牌和相关信息
    func exchangeCodeForToken(code: String) async throws -> NotionOAuthTokenResponse {
        guard let tokenURL = URL(string: Self.tokenURL) else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: "Invalid token URL"]
            )
        }
        
        let requestBody: [String: Any] = [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": Self.redirectURI,
            "client_id": Self.clientId,
            "client_secret": Self.clientSecret
        ]
        
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        
        logger.info("Exchanging authorization code for access token")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 9,
                userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response"]
            )
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(
                domain: "NotionOAuthService",
                code: httpResponse.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Token exchange failed: HTTP \(httpResponse.statusCode) - \(errorBody)"]
            )
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        
        guard let accessToken = json["access_token"] as? String else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "No access_token in response"]
            )
        }
        
        // 可选：获取 workspace 信息
        let workspace = json["workspace"] as? [String: Any]
        let workspaceId = workspace?["id"] as? String
        let workspaceName = workspace?["name"] as? String
        
        logger.info("Successfully obtained access token for workspace: \(workspaceName ?? "unknown")")
        
        return NotionOAuthTokenResponse(
            accessToken: accessToken,
            workspaceId: workspaceId,
            workspaceName: workspaceName
        )
    }
    
    /// 完整的 OAuth 授权流程（启动授权 + 交换令牌）
    /// - Returns: 访问令牌和相关信息
    func performFullAuthorization() async throws -> NotionOAuthTokenResponse {
        guard let code = try await startAuthorization() else {
            throw NSError(
                domain: "NotionOAuthService",
                code: 11,
                userInfo: [NSLocalizedDescriptionKey: "User canceled authorization"]
            )
        }
        
        return try await exchangeCodeForToken(code: code)
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

private final class OAuthPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = OAuthPresentationContextProvider()
    
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // 返回主窗口作为展示锚点
        return NSApplication.shared.windows.first { $0.isKeyWindow } ?? NSApplication.shared.windows.first ?? NSWindow()
    }
}

// MARK: - Models

struct NotionOAuthTokenResponse {
    let accessToken: String
    let workspaceId: String?
    let workspaceName: String?
}

