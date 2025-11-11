import Foundation

/// Notion OAuth 配置加载器
/// 从环境变量或配置文件中读取敏感信息，避免硬编码在代码中
final class NotionOAuthConfig {
    // 配置键名
    private static let clientIdKey = "NOTION_OAUTH_CLIENT_ID"
    private static let clientSecretKey = "NOTION_OAUTH_CLIENT_SECRET"
    
    // 默认重定向 URI（不需要保密）
    static let redirectURI = "http://localhost:8080/oauth/callback"
    
    // 缓存配置值（避免重复读取）
    private static var cachedClientId: String?
    private static var cachedClientSecret: String?
    
    /// 从环境变量或配置文件中加载 Client ID
    static var clientId: String {
        if let cached = cachedClientId {
            return cached
        }
        
        // 1. 优先从环境变量读取
        if let envValue = ProcessInfo.processInfo.environment[clientIdKey], !envValue.isEmpty {
            cachedClientId = envValue
            return envValue
        }
        
        // 2. 从配置文件读取
        if let configValue = loadFromConfigFile(key: clientIdKey), !configValue.isEmpty {
            cachedClientId = configValue
            return configValue
        }
        
        // 3. 如果都没有，返回占位符（会在运行时检查并提示）
        return "YOUR_CLIENT_ID"
    }
    
    /// 从环境变量或配置文件中加载 Client Secret
    static var clientSecret: String {
        if let cached = cachedClientSecret {
            return cached
        }
        
        // 1. 优先从环境变量读取
        if let envValue = ProcessInfo.processInfo.environment[clientSecretKey], !envValue.isEmpty {
            cachedClientSecret = envValue
            return envValue
        }
        
        // 2. 从配置文件读取
        if let configValue = loadFromConfigFile(key: clientSecretKey), !configValue.isEmpty {
            cachedClientSecret = configValue
            return configValue
        }
        
        // 3. 如果都没有，返回占位符（会在运行时检查并提示）
        return "YOUR_CLIENT_SECRET"
    }
    
    /// 从配置文件加载值
    /// 配置文件路径：应用 Bundle 中的 notion_auth.env，或用户主目录下的 .syncnos/notion_auth.env
    private static func loadFromConfigFile(key: String) -> String? {
        // 尝试多个可能的配置文件路径
        let configPaths = [
            // 1. Bundle 中的配置文件（用于开发）
            Bundle.main.path(forResource: "notion_auth", ofType: "env"),
            // 2. 用户主目录下的配置文件（用于生产环境）
            FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".syncnos")
                .appendingPathComponent("notion_auth.env")
                .path
        ]
        
        for configPath in configPaths.compactMap({ $0 }) {
            guard FileManager.default.fileExists(atPath: configPath) else { continue }
            
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
                // 忽略读取错误，继续尝试下一个路径
                continue
            }
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

