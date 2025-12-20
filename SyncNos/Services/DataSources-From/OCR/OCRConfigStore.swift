import Foundation

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    var apiURL: String? { get set }
    var token: String? { get set }
    var isConfigured: Bool { get }
}

// MARK: - OCR Config Store

/// PaddleOCR-VL API 配置存储
/// Token 从 https://aistudio.baidu.com/paddleocr/task 获取
final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - Published Properties
    
    @Published var apiURL: String? {
        didSet { save(apiURL, forKey: .apiURL) }
    }
    
    @Published var token: String? {
        didSet { save(token, forKey: .token) }
    }
    
    // MARK: - Computed Properties
    
    var isConfigured: Bool {
        guard let url = apiURL, let token = token else { return false }
        return !url.isEmpty && !token.isEmpty
    }
    
    // MARK: - Init
    
    private init() {
        self.apiURL = UserDefaults.standard.string(forKey: Keys.apiURL.rawValue)
        self.token = UserDefaults.standard.string(forKey: Keys.token.rawValue)
    }
    
    // MARK: - Keys
    
    private enum Keys: String {
        case apiURL = "ocr_paddle_api_url"
        case token = "ocr_paddle_token"
    }
    
    private func save(_ value: String?, forKey key: Keys) {
        UserDefaults.standard.set(value, forKey: key.rawValue)
    }
}
