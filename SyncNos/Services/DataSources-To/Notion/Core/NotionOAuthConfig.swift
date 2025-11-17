import Foundation

/// Notion OAuth 配置加载器
/// 现在从运行时环境变量读取敏感配置（ProcessInfo.processInfo.environment）
/// 推荐在 Xcode 中通过: Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables 设置
final class NotionOAuthConfig {
    // 配置键名
    private static let clientIdKey = "NOTION_OAUTH_CLIENT_ID"
    private static let clientSecretKey = "NOTION_OAUTH_CLIENT_SECRET"

    // 使用 GitHub Pages 作为 OAuth 回调中转
    // GitHub Pages 页面会重定向到自定义 URL scheme (syncnos://)
    static let redirectURI = "https://chiimagnus.github.io/syncnos-oauth/callback"

    // 缓存配置值（避免重复读取）
    private static var cachedClientId: String?
    private static var cachedClientSecret: String?

    /// 从环境变量读取 Client ID（优先），如未设置则返回占位符
    static var clientId: String {
        if let cached = cachedClientId {
            return cached
        }

        if let env = ProcessInfo.processInfo.environment[clientIdKey], !env.isEmpty {
            cachedClientId = env
            return env
        }

        // 未配置时返回占位符，调用方应提示或处理
        return "YOUR_CLIENT_ID"
    }

    /// 从环境变量读取 Client Secret（优先），如未设置则返回占位符
    static var clientSecret: String {
        if let cached = cachedClientSecret {
            return cached
        }

        if let env = ProcessInfo.processInfo.environment[clientSecretKey], !env.isEmpty {
            cachedClientSecret = env
            return env
        }

        return "YOUR_CLIENT_SECRET"
    }

    /// 检查配置是否已设置
    static var isConfigured: Bool {
        return clientId != "YOUR_CLIENT_ID" && clientSecret != "YOUR_CLIENT_SECRET"
    }

    /// 清除缓存（用于测试或重新加载配置）
    static func clearCache() {
        cachedClientId = nil
        cachedClientSecret = nil
    }
}

