import Foundation

// MARK: - OCR Engine Type

/// OCR 引擎类型
enum OCREngineType: String, CaseIterable, Codable {
    /// Apple Vision 框架（原生，离线，免配置）
    case vision = "vision"
    /// PaddleOCR-VL 云端 API（需要配置 API URL 和 Token）
    case paddleOCR = "paddleocr"
    
    var displayName: String {
        switch self {
        case .vision:
            return "Apple Vision"
        case .paddleOCR:
            return "PaddleOCR API"
        }
    }
    
    var description: String {
        switch self {
        case .vision:
            return String(localized: "ocr.engine.vision.description", defaultValue: "Native macOS OCR, offline, no configuration required")
        case .paddleOCR:
            return String(localized: "ocr.engine.paddleocr.description", defaultValue: "Cloud API, supports 109 languages, tables, formulas")
        }
    }
    
    var iconName: String {
        switch self {
        case .vision:
            return "eye"
        case .paddleOCR:
            return "cloud"
        }
    }
}

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    var apiURL: String? { get set }
    var token: String? { get set }
    var isConfigured: Bool { get }
    var selectedEngine: OCREngineType { get set }
    var isPaddleOCRConfigured: Bool { get }
}

// MARK: - OCR Config Store

/// OCR 配置存储
/// - 引擎选择: 存储在 UserDefaults
/// - API URL: 存储在 UserDefaults（非敏感）
/// - Token: 存储在 Keychain（敏感信息，加密存储）
final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - Constants
    
    private let keychainService = "com.syncnos.ocr"
    private let tokenAccount = "paddle_token"
    private let apiURLKey = "ocr_paddle_api_url"
    private let engineKey = "ocr_selected_engine"
    
    // MARK: - Published Properties
    
    /// 当前选择的 OCR 引擎
    @Published var selectedEngine: OCREngineType {
        didSet {
            UserDefaults.standard.set(selectedEngine.rawValue, forKey: engineKey)
        }
    }
    
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
    
    /// 当前引擎是否已配置（Vision 始终可用，PaddleOCR 需要配置）
    var isConfigured: Bool {
        switch selectedEngine {
        case .vision:
            return true
        case .paddleOCR:
            return isPaddleOCRConfigured
        }
    }
    
    /// PaddleOCR 是否已配置
    var isPaddleOCRConfigured: Bool {
        guard let url = apiURL, let token = token else { return false }
        return !url.isEmpty && !token.isEmpty
    }
    
    // MARK: - Init
    
    private init() {
        // 从 UserDefaults 加载引擎选择（默认使用 Vision）
        if let rawValue = UserDefaults.standard.string(forKey: engineKey),
           let engine = OCREngineType(rawValue: rawValue) {
            self.selectedEngine = engine
        } else {
            self.selectedEngine = .vision
        }
        
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
