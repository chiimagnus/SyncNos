import Foundation

/// Notion OAuth 配置加载器
/// 从配置文件中读取敏感信息，避免硬编码在代码中
/// 配置文件位置：应用 Bundle 中的 notion_auth.env（需要添加到 Xcode Target 的 "Copy Bundle Resources"）
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
    
    /// 从配置文件中加载 Client ID
    static var clientId: String {
        if let cached = cachedClientId {
            return cached
        }
        
        // 从 Bundle 中的配置文件读取
        if let configValue = loadFromConfigFile(key: clientIdKey), !configValue.isEmpty {
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
        
        // 从 Bundle 中的配置文件读取
        if let configValue = loadFromConfigFile(key: clientSecretKey), !configValue.isEmpty {
            cachedClientSecret = configValue
            return configValue
        }
        
        // 如果找不到，返回占位符（会在运行时检查并提示）
        return "YOUR_CLIENT_SECRET"
    }
    
    /// 从 Bundle 中的配置文件加载值
    /// 配置文件路径：应用 Bundle 中的 notion_auth.env
    private static func loadFromConfigFile(key: String) -> String? {
        // 从 Bundle 中读取配置文件
        guard let configPath = Bundle.main.path(forResource: "notion_auth", ofType: "env"),
              FileManager.default.fileExists(atPath: configPath) else {
            return nil
        }
        
        do {
            let content = try String(contentsOfFile: configPath, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines)
            
            for line in lines {
                // 跳过注释和空行
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty || trimmed.hasPrefix("#") {
                    continue
                }
                
                // 解析 KEY=VALUE 格式
                let parts = trimmed.components(separatedBy: "=")
                if parts.count >= 2 {
                    let configKey = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
                    let configValue = parts.dropFirst().joined(separator: "=")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'")) // 移除引号
                    
                    if configKey == key {
                        return configValue
                    }
                }
            }
        } catch {
            // 忽略读取错误
            return nil
        }
        
        return nil
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

