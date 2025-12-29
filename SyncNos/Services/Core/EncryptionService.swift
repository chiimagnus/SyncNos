import CryptoKit
import Foundation
import os.log
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
    
    /// 验证密钥健康状态（检查密钥是否存在且可用）
    func validateKeyHealth() -> EncryptionKeyHealthStatus
}

// MARK: - Key Health Status

/// 加密密钥健康状态
enum EncryptionKeyHealthStatus: Equatable {
    /// 密钥健康：从 Keychain 加载成功
    case healthy
    /// 密钥是新生成的（首次使用或密钥丢失后重新生成）
    case newlyGenerated
    /// 密钥不可用
    case unavailable(reason: String)
    
    var isHealthy: Bool {
        switch self {
        case .healthy, .newlyGenerated:
            return true
        case .unavailable:
            return false
        }
    }
    
    var isNewlyGenerated: Bool {
        if case .newlyGenerated = self {
            return true
        }
        return false
    }
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
///
/// 诊断功能：
/// - 使用 os.log 记录解密失败的详细信息（不记录敏感数据）
/// - 提供 `validateKeyHealth()` 方法检查密钥状态
final class EncryptionService: EncryptionServiceProtocol {
    static let shared = EncryptionService()
    
    // MARK: - Constants
    
    private let keychainService = "com.syncnos.encryption"
    private let keychainAccount = "chats.aes.key"
    
    /// 日志子系统（用于 Console.app 筛选）
    private static let logger = Logger(subsystem: "com.syncnos", category: "Encryption")
    
    // MARK: - State
    
    /// 缓存的密钥（避免频繁访问 Keychain）
    private var cachedKey: SymmetricKey?
    
    /// 标记密钥是否为新生成（用于健康检查）
    private var keyWasNewlyGenerated = false
    
    /// 线程安全队列
    private let queue = DispatchQueue(label: "com.syncnos.encryption", attributes: .concurrent)
    
    /// 密钥生成锁（防止并发生成多个密钥）
    private let keyGenerationLock = NSLock()
    
    // MARK: - Init
    
    private init() {}
    
    // MARK: - Public API
    
    /// 加密字符串
    /// - Parameter plaintext: 明文字符串
    /// - Returns: 加密后的数据（combined 格式：nonce + ciphertext + tag）
    func encrypt(_ plaintext: String) throws -> Data {
        let key = try loadOrCreateKey()
        
        guard let data = plaintext.data(using: .utf8) else {
            Self.logger.error("[Encryption] UTF-8 encoding failed for plaintext (length: \(plaintext.count))")
            throw EncryptionError.encodingFailed
        }
        
        do {
            let sealedBox = try AES.GCM.seal(data, using: key)
            
            guard let combined = sealedBox.combined else {
                Self.logger.error("[Encryption] AES-GCM seal succeeded but combined data is nil")
                throw EncryptionError.sealingFailed
            }
            
            return combined
        } catch let error as EncryptionError {
            throw error
        } catch {
            Self.logger.error("[Encryption] AES-GCM seal failed: \(error.localizedDescription)")
            throw EncryptionError.sealingFailed
        }
    }
    
    /// 解密数据
    /// - Parameter ciphertext: 加密数据（combined 格式）
    /// - Returns: 解密后的明文字符串
    func decrypt(_ ciphertext: Data) throws -> String {
        // 验证输入数据
        guard !ciphertext.isEmpty else {
            Self.logger.error("[Decryption] Empty ciphertext provided")
            throw EncryptionError.invalidCiphertext(reason: "Empty data")
        }
        
        // AES-GCM combined 格式最小长度：nonce(12) + tag(16) = 28 bytes
        guard ciphertext.count >= 28 else {
            Self.logger.error("[Decryption] Ciphertext too short: \(ciphertext.count) bytes (minimum 28)")
            throw EncryptionError.invalidCiphertext(reason: "Data too short (\(ciphertext.count) bytes)")
        }
        
        let key: SymmetricKey
        do {
            key = try loadOrCreateKey()
        } catch {
            Self.logger.error("[Decryption] Failed to load key: \(error.localizedDescription)")
            throw EncryptionError.keyLoadFailed(underlying: error)
        }
        
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.SealedBox(combined: ciphertext)
        } catch {
            Self.logger.error("[Decryption] Invalid ciphertext format: \(error.localizedDescription)")
            throw EncryptionError.invalidCiphertext(reason: error.localizedDescription)
        }
        
        let decryptedData: Data
        do {
            decryptedData = try AES.GCM.open(sealedBox, using: key)
        } catch CryptoKitError.authenticationFailure {
            // 这是最常见的解密失败原因：密钥不匹配或数据损坏
            Self.logger.error("[Decryption] Authentication failed - key mismatch or data corrupted (ciphertext: \(ciphertext.count) bytes)")
            throw EncryptionError.authenticationFailed
        } catch {
            Self.logger.error("[Decryption] AES-GCM open failed: \(error.localizedDescription)")
            throw EncryptionError.decryptionFailed(underlying: error)
        }
        
        guard let plaintext = String(data: decryptedData, encoding: .utf8) else {
            Self.logger.error("[Decryption] UTF-8 decoding failed for decrypted data (\(decryptedData.count) bytes)")
            throw EncryptionError.decodingFailed
        }
        
        return plaintext
    }
    
    /// 检查加密是否可用（密钥可加载或生成）
    var isAvailable: Bool {
        (try? loadOrCreateKey()) != nil
    }
    
    /// 验证密钥健康状态
    /// - Returns: 密钥健康状态
    func validateKeyHealth() -> EncryptionKeyHealthStatus {
        // 使用锁确保整个健康检查过程的原子性
        keyGenerationLock.lock()
        defer { keyGenerationLock.unlock() }
        
        // 检查 Keychain 中是否存在密钥
        if let keyData = KeychainHelper.shared.read(service: keychainService, account: keychainAccount) {
            // 验证密钥长度（AES-256 = 32 bytes）
            if keyData.count == 32 {
                Self.logger.info("[Encryption] Key health check: OK (key exists in Keychain)")
                return .healthy
            } else {
                Self.logger.warning("[Encryption] Key health check: Invalid key length (\(keyData.count) bytes, expected 32)")
                return .unavailable(reason: "Invalid key length")
            }
        }
        
        // 密钥不存在于 Keychain，检查内存中是否有新生成的标记
        let wasNewlyGenerated = queue.sync { keyWasNewlyGenerated }
        if wasNewlyGenerated {
            Self.logger.warning("[Encryption] Key health check: Key was newly generated (previous data may be unrecoverable)")
            return .newlyGenerated
        }
        
        // Keychain 中没有密钥，且没有标记为新生成，需要创建新密钥
        // 再次检查 Keychain（防御性编程）
        if KeychainHelper.shared.read(service: keychainService, account: keychainAccount) != nil {
            return .healthy
        }
        
        // 生成新密钥
        Self.logger.warning("[Encryption] No key found in Keychain during health check, generating new key...")
        let newKey = SymmetricKey(size: .bits256)
        
        let saved = saveKeyToKeychain(newKey)
        if !saved {
            Self.logger.error("[Encryption] Key health check: Failed to save new key to Keychain")
            return .unavailable(reason: "Failed to save new key")
        }
        
        // 通过 queue 更新缓存和标记（barrier 确保写入可见性）
        queue.async(flags: .barrier) { [weak self] in
            self?.cachedKey = newKey
            self?.keyWasNewlyGenerated = true
        }
        
        Self.logger.warning("[Encryption] Key health check: New key generated (no previous key found)")
        return .newlyGenerated
    }
    
    /// 删除加密密钥（用于调试或重置）
    /// - Warning: 删除密钥后，所有已加密数据将无法解密
    func deleteKey() {
        keyGenerationLock.lock()
        defer { keyGenerationLock.unlock() }
        
        // 通过 queue 清除缓存（barrier 确保写入可见性）
        queue.async(flags: .barrier) { [weak self] in
            self?.cachedKey = nil
            self?.keyWasNewlyGenerated = false
        }
        
        let deleted = KeychainHelper.shared.delete(
            service: keychainService,
            account: keychainAccount
        )
        
        if deleted {
            Self.logger.warning("[Encryption] Key deleted from Keychain - all encrypted data is now unrecoverable")
        } else {
            Self.logger.error("[Encryption] Failed to delete key from Keychain")
        }
    }
    
    // MARK: - Key Management
    
    /// 加载或创建加密密钥（线程安全）
    ///
    /// 同步策略：
    /// - 快速路径：使用 `queue.sync` 读取缓存，无锁
    /// - 慢路径：使用 `keyGenerationLock` 序列化 Keychain 访问和密钥生成
    /// - 缓存写入：使用 `queue.async(flags: .barrier)` 确保线程安全
    private func loadOrCreateKey() throws -> SymmetricKey {
        // 快速路径：检查缓存
        if let key = queue.sync(execute: { cachedKey }) {
            return key
        }
        
        // 慢路径：需要访问 Keychain，使用锁防止并发
        keyGenerationLock.lock()
        defer { keyGenerationLock.unlock() }
        
        // 双重检查：获取锁后再次检查缓存（通过 queue 确保可见性）
        if let key = queue.sync(execute: { cachedKey }) {
            return key
        }
        
        // 尝试从 Keychain 加载
        if let keyData = KeychainHelper.shared.read(service: keychainService, account: keychainAccount) {
            // 验证密钥长度
            guard keyData.count == 32 else {
                Self.logger.error("[Encryption] Invalid key data in Keychain: \(keyData.count) bytes (expected 32)")
                throw EncryptionError.invalidKeyData
            }
            
            let key = SymmetricKey(data: keyData)
            // 异步更新缓存（barrier 确保写入可见性）
            queue.async(flags: .barrier) { [weak self] in
                self?.cachedKey = key
                self?.keyWasNewlyGenerated = false
            }
            Self.logger.info("[Encryption] Key loaded from Keychain successfully")
            return key
        }
        
        // Keychain 中没有密钥，生成新密钥
        Self.logger.warning("[Encryption] No key found in Keychain, generating new key...")
        let newKey = SymmetricKey(size: .bits256)
        
        // 保存到 Keychain
        let saved = saveKeyToKeychain(newKey)
        guard saved else {
            Self.logger.error("[Encryption] Failed to save new key to Keychain")
            throw EncryptionError.keySaveFailed
        }
        
        // 异步更新缓存（barrier 确保写入可见性）
        queue.async(flags: .barrier) { [weak self] in
            self?.cachedKey = newKey
            self?.keyWasNewlyGenerated = true
        }
        
        Self.logger.warning("[Encryption] New key generated and saved - previously encrypted data cannot be decrypted")
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
        
        if status != errSecSuccess {
            Self.logger.error("[Encryption] Keychain SecItemAdd failed with status: \(status)")
        }
        
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
    /// 密钥数据无效（长度不正确）
    case invalidKeyData
    /// 密钥加载失败
    case keyLoadFailed(underlying: Error)
    /// AES-GCM 解密失败（认证标签不匹配 - 通常是密钥不匹配或数据损坏）
    case authenticationFailed
    /// 解密失败（其他原因）
    case decryptionFailed(underlying: Error)
    /// 无效的密文数据
    case invalidCiphertext(reason: String)
    
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
        case .invalidKeyData:
            return "Invalid encryption key data in Keychain"
        case .keyLoadFailed(let underlying):
            return "Failed to load encryption key: \(underlying.localizedDescription)"
        case .authenticationFailed:
            return "AES-GCM authentication failed - encryption key may have changed or data is corrupted"
        case .decryptionFailed(let underlying):
            return "Decryption failed: \(underlying.localizedDescription)"
        case .invalidCiphertext(let reason):
            return "Invalid ciphertext: \(reason)"
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

