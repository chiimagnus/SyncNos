import Foundation

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    var apiURL: String? { get set }
    var token: String? { get set }
    var isConfigured: Bool { get }
}

// MARK: - OCR Config Store

/// PaddleOCR-VL API 配置存储
/// - API URL: 存储在 UserDefaults（非敏感）
/// - Token: 存储在 Keychain（敏感信息，加密存储）
final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - Constants
    
    private let keychainService = "com.syncnos.ocr"
    private let tokenAccount = "paddle_token"
    private let apiURLKey = "ocr_paddle_api_url"
    
    // MARK: - Published Properties
    
    @Published var apiURL: String? {
        didSet {
            UserDefaults.standard.set(apiURL, forKey: apiURLKey)
        }
    }
    
    @Published var token: String? {
        didSet {
            saveTokenToKeychain(token)
        }
    }
    
    // MARK: - Computed Properties
    
    var isConfigured: Bool {
        guard let url = apiURL, let token = token else { return false }
        return !url.isEmpty && !token.isEmpty
    }
    
    // MARK: - Init
    
    private init() {
        // 从 UserDefaults 加载 API URL
        self.apiURL = UserDefaults.standard.string(forKey: apiURLKey)
        
        // 从 Keychain 加载 Token
        self.token = loadTokenFromKeychain()
    }
    
    // MARK: - Keychain Methods
    
    private func saveTokenToKeychain(_ token: String?) {
        if let token = token, !token.isEmpty {
            guard let data = token.data(using: .utf8) else { return }
            KeychainHelper.shared.save(service: keychainService, account: tokenAccount, data: data)
        } else {
            KeychainHelper.shared.delete(service: keychainService, account: tokenAccount)
        }
    }
    
    private func loadTokenFromKeychain() -> String? {
        guard let data = KeychainHelper.shared.read(service: keychainService, account: tokenAccount) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
    
    // MARK: - Clear Methods
    
    func clearAll() {
        apiURL = nil
        token = nil
    }
}
