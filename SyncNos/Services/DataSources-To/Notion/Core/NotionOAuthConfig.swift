import Foundation

/// Notion OAuth 配置加载器
final class NotionOAuthConfig {
    // 使用 GitHub Pages 作为 OAuth 回调中转
    // GitHub Pages 页面会重定向到自定义 URL scheme (syncnos://)
    static let redirectURI = "https://chiimagnus.github.io/syncnos-oauth/callback"

    // 缓存配置值（避免重复读取）
    private static var cachedClientId: String?
    private static var cachedClientSecret: String?

    /// 从配置文件中加载 Client ID
    static var clientId: String {
        if let cached = cachedClientId { return cached }
        let configValue = NotionConfig.clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configValue.isEmpty && configValue != "YOUR_CLIENT_ID" {
            cachedClientId = configValue
            return configValue
        }
        return "YOUR_CLIENT_ID"
    }

    /// 从配置文件中加载 Client Secret
    static var clientSecret: String {
        if let cached = cachedClientSecret { return cached }
        let configValue = NotionConfig.clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configValue.isEmpty && configValue != "YOUR_CLIENT_SECRET" {
            cachedClientSecret = configValue
            return configValue
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

