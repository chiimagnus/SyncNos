import Foundation

/// Notion OAuth 配置加载器
/// 使用 Keychain + 本地 Swift 配置文件（`NotionConfig.swift`）管理敏感信息，
/// 避免 `.env` 明文文件进入应用包。
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

    // Keychain 配置
    private static let keychainService = "com.chiimagnus.SyncNos.NotionOAuth"
    private static let keychainClientIdAccount = "notion_client_id"
    private static let keychainClientSecretAccount = "notion_client_secret"
    
    /// 从配置文件中加载 Client ID
    static var clientId: String {
        if let cached = cachedClientId {
            return cached
        }
        
        // 1. 优先从 Keychain 读取
        if let keychainValue = loadFromKeychain(account: keychainClientIdAccount), !keychainValue.isEmpty {
            cachedClientId = keychainValue
            return keychainValue
        }

        // 2. 其次从本地 Swift 配置文件读取，并在首次读取时写入 Keychain
        let configValue = NotionConfig.clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configValue.isEmpty, configValue != "YOUR_CLIENT_ID" {
            saveToKeychain(value: configValue, account: keychainClientIdAccount)
            cachedClientId = configValue
            return configValue
        }
        
        // 如果找不到，返回占位符（会在运行时检查并提示）
        return "YOUR_CLIENT_ID"
    }
    
    /// 从配置文件中加载 Client Secret
    static var clientSecret: String {
        if let cached = cachedClientSecret {
            return cached
        }
        
        // 1. 优先从 Keychain 读取
        if let keychainValue = loadFromKeychain(account: keychainClientSecretAccount), !keychainValue.isEmpty {
            cachedClientSecret = keychainValue
            return keychainValue
        }

        // 2. 其次从本地 Swift 配置文件读取，并在首次读取时写入 Keychain
        let configValue = NotionConfig.clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configValue.isEmpty, configValue != "YOUR_CLIENT_SECRET" {
            saveToKeychain(value: configValue, account: keychainClientSecretAccount)
            cachedClientSecret = configValue
            return configValue
        }
        
        // 如果找不到，返回占位符（会在运行时检查并提示）
        return "YOUR_CLIENT_SECRET"
    }
    
    // MARK: - Keychain helpers

    /// 从 Keychain 读取字符串
    private static func loadFromKeychain(account: String) -> String? {
        guard let data = KeychainHelper.shared.read(service: keychainService, account: account),
              !data.isEmpty,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    /// 将字符串写入 Keychain
    @discardableResult
    private static func saveToKeychain(value: String, account: String) -> Bool {
        guard let data = value.data(using: .utf8) else {
            return false
        }
        return KeychainHelper.shared.save(service: keychainService, account: account, data: data)
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

