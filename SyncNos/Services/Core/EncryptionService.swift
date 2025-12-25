import CryptoKit
import Foundation
import Security

// MARK: - Encryption Service Protocol

/// 本地数据加密服务协议
protocol EncryptionServiceProtocol {
    /// 加密字符串
    func encrypt(_ plaintext: String) throws -> Data
    
    /// 解密数据
    func decrypt(_ ciphertext: Data) throws -> String
    
    /// 检查加密是否可用
    var isAvailable: Bool { get }
}

// MARK: - Encryption Service

/// 本地数据加密服务（使用 CryptoKit AES-256-GCM + Keychain）
///
/// 安全设计：
/// - 使用 AES-256-GCM 认证加密（NIST 推荐）
/// - 密钥存储在 macOS Keychain
/// - 每次加密使用不同 nonce（防重放攻击）
/// - 不同步到 iCloud Keychain
/// - 仅在设备解锁时可访问
///
/// 开源安全性说明（Kerckhoffs 原则）：
/// 算法公开不影响安全性，安全性完全依赖密钥的保密性。
/// 密钥由系统 Keychain 保护，受 macOS 登录密码保护。
final class EncryptionService: EncryptionServiceProtocol {
    static let shared = EncryptionService()
    
    // MARK: - Constants
    
    private let keychainService = "com.syncnos.encryption"
    private let keychainAccount = "wechat.aes.key"
    
    // MARK: - State
    
    /// 缓存的密钥（避免频繁访问 Keychain）
    private var cachedKey: SymmetricKey?
    
    /// 线程安全队列
    private let queue = DispatchQueue(label: "com.syncnos.encryption", attributes: .concurrent)
    
    // MARK: - Init
    
    private init() {}
    
    // MARK: - Public API
    
    /// 加密字符串
    /// - Parameter plaintext: 明文字符串
    /// - Returns: 加密后的数据（combined 格式：nonce + ciphertext + tag）
    func encrypt(_ plaintext: String) throws -> Data {
        let key = try loadOrCreateKey()
        
        guard let data = plaintext.data(using: .utf8) else {
            throw EncryptionError.encodingFailed
        }
        
        let sealedBox = try AES.GCM.seal(data, using: key)
        
        guard let combined = sealedBox.combined else {
            throw EncryptionError.sealingFailed
        }
        
        return combined
    }
    
    /// 解密数据
    /// - Parameter ciphertext: 加密数据（combined 格式）
    /// - Returns: 解密后的明文字符串
    func decrypt(_ ciphertext: Data) throws -> String {
        let key = try loadOrCreateKey()
        
        let sealedBox = try AES.GCM.SealedBox(combined: ciphertext)
        let decryptedData = try AES.GCM.open(sealedBox, using: key)
        
        guard let plaintext = String(data: decryptedData, encoding: .utf8) else {
            throw EncryptionError.decodingFailed
        }
        
        return plaintext
    }
    
    /// 检查加密是否可用（密钥可加载或生成）
    var isAvailable: Bool {
        (try? loadOrCreateKey()) != nil
    }
    
    /// 删除加密密钥（用于调试或重置）
    /// - Warning: 删除密钥后，所有已加密数据将无法解密
    func deleteKey() {
        queue.async(flags: .barrier) { [weak self] in
            self?.cachedKey = nil
            KeychainHelper.shared.delete(
                service: self?.keychainService ?? "",
                account: self?.keychainAccount ?? ""
            )
        }
    }
    
    // MARK: - Key Management
    
    /// 加载或创建加密密钥
    private func loadOrCreateKey() throws -> SymmetricKey {
        // 检查缓存
        if let key = queue.sync(execute: { cachedKey }) {
            return key
        }
        
        // 尝试从 Keychain 加载
        if let keyData = KeychainHelper.shared.read(service: keychainService, account: keychainAccount) {
            let key = SymmetricKey(data: keyData)
            queue.async(flags: .barrier) { [weak self] in
                self?.cachedKey = key
            }
            return key
        }
        
        // 生成新密钥
        let newKey = SymmetricKey(size: .bits256)
        
        // 保存到 Keychain
        let saved = saveKeyToKeychain(newKey)
        guard saved else {
            throw EncryptionError.keySaveFailed
        }
        
        queue.async(flags: .barrier) { [weak self] in
            self?.cachedKey = newKey
        }
        
        return newKey
    }
    
    /// 将密钥保存到 Keychain（带安全属性）
    private func saveKeyToKeychain(_ key: SymmetricKey) -> Bool {
        let keyData = key.withUnsafeBytes { Data($0) }
        
        // 使用更安全的 Keychain 属性
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: keyData,
            // 仅在设备解锁时可访问
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
            // 不同步到 iCloud Keychain
            kSecAttrSynchronizable as String: kCFBooleanFalse!
        ]
        
        // 先删除旧的（如果存在）
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(deleteQuery as CFDictionary)
        
        // 添加新的
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }
}

// MARK: - Encryption Errors

/// 加密服务错误类型
enum EncryptionError: Error, LocalizedError {
    /// UTF-8 编码失败
    case encodingFailed
    /// UTF-8 解码失败
    case decodingFailed
    /// AES-GCM 封装失败
    case sealingFailed
    /// 密钥未找到
    case keyNotFound
    /// 密钥保存失败
    case keySaveFailed
    /// AES-GCM 解密失败（认证标签不匹配）
    case authenticationFailed
    
    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Failed to encode plaintext to UTF-8"
        case .decodingFailed:
            return "Failed to decode ciphertext to UTF-8 string"
        case .sealingFailed:
            return "Failed to seal data with AES-GCM"
        case .keyNotFound:
            return "Encryption key not found in Keychain"
        case .keySaveFailed:
            return "Failed to save encryption key to Keychain"
        case .authenticationFailed:
            return "AES-GCM authentication failed - data may be corrupted"
        }
    }
}

// MARK: - Optional String Extension

extension EncryptionService {
    /// 加密可选字符串
    /// - Note: 使用 `encryptOptional` 避免与 `encrypt(_:)` 重载歧义
    func encryptOptional(_ plaintext: String?) throws -> Data? {
        guard let plaintext = plaintext else { return nil }
        return try encrypt(plaintext)
    }
    
    /// 解密可选数据
    /// - Note: 使用 `decryptOptional` 避免与 `decrypt(_:)` 重载歧义
    func decryptOptional(_ ciphertext: Data?) throws -> String? {
        guard let ciphertext = ciphertext else { return nil }
        return try decrypt(ciphertext)
    }
}

