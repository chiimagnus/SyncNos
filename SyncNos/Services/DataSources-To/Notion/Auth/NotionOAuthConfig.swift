import Foundation

/// Notion OAuth 配置加载器
final class NotionOAuthConfig {
    static let defaultClientId = "2a8d872b-594c-8060-9a2b-00377c27ec32"

    // 使用 GitHub Pages 作为 OAuth 回调中转
    // GitHub Pages 页面会重定向到自定义 URL scheme (syncnos://)
    static let redirectURI = "https://chiimagnus.github.io/syncnos-oauth/callback"

    // 缓存配置值（避免重复读取）
    private static var cachedClientId: String?

    /// 从配置文件中加载 Client ID
    static var clientId: String {
        if let cached = cachedClientId { return cached }
        cachedClientId = defaultClientId
        return defaultClientId
    }

    /// 检查配置是否已设置
    static var isConfigured: Bool {
        return !clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// 清除缓存（用于测试或重新加载配置）
    static func clearCache() {
        cachedClientId = nil
    }
}
