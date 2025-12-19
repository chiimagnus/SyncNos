import Foundation
import Security

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol {
    var apiKey: String? { get set }
    var isConfigured: Bool { get }
}

// MARK: - OCR Config Store

/// OCR 配置存储（硅基流动 DeepSeek-OCR）
/// 使用 Keychain 安全存储 API Key
final class OCRConfigStore: OCRConfigStoreProtocol {
    static let shared = OCRConfigStore()
    
    // MARK: - Constants
    
    /// 硅基流动 API 端点
    static let baseURL = "https://api.siliconflow.cn/v1"
    
    /// DeepSeek-OCR 模型名称
    static let model = "deepseek-ai/DeepSeek-OCR"
    
    // MARK: - Keys
    private enum Keys {
        static let keychainService = "com.syncnos.ocr.siliconflow"
        static let keychainAccount = "apiKey"
    }
    
    // MARK: - Properties
    
    var apiKey: String? {
        get {
            return retrieveAPIKeyFromKeychain()
        }
        set {
            if let key = newValue, !key.isEmpty {
                saveAPIKeyToKeychain(key)
            } else {
                deleteAPIKeyFromKeychain()
            }
        }
    }
    
    var isConfigured: Bool {
        guard let key = apiKey, !key.isEmpty else {
            return false
        }
        return true
    }
    
    // MARK: - Init
    
    private init() {}
    
    // MARK: - Keychain Operations
    
    private func saveAPIKeyToKeychain(_ apiKey: String) {
        // 先删除旧的
        deleteAPIKeyFromKeychain()
        
        guard let data = apiKey.data(using: .utf8) else { return }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Keys.keychainService,
            kSecAttrAccount as String: Keys.keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked
        ]
        
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("[OCRConfigStore] Failed to save API key to Keychain: \(status)")
        }
    }
    
    private func retrieveAPIKeyFromKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Keys.keychainService,
            kSecAttrAccount as String: Keys.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let apiKey = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return apiKey
    }
    
    private func deleteAPIKeyFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Keys.keychainService,
            kSecAttrAccount as String: Keys.keychainAccount
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
