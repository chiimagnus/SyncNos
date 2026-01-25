import Foundation

/// 本文件用于存放 Notion OAuth 的敏感配置（Client ID / Client Secret）。
/// ⚠️ 注意：
/// - 此文件已被 `.gitignore` 忽略，不会提交到远程仓库。
/// - 应用运行时会优先从 Keychain 读取配置，仅在 Keychain 为空时使用这里的值，
///   并在首次使用时自动写入 Keychain。
///
/// 使用方式：
/// 1. 在本地填写真实的 Client ID / Client Secret。
/// 2. 构建运行应用，`NotionOAuthConfig` 会将其写入 Keychain。
/// 3. 之后即使你修改或清空此文件，应用仍可从 Keychain 读取配置。
enum NotionConfig {
    /// Notion Integration 的 Client ID
    static let clientId: String = "YOUR_CLIENT_ID"

    /// Notion Integration 的 Client Secret
    static let clientSecret: String = "YOUR_CLIENT_SECRET"
}
