import Foundation

// MARK: - OCR Provider

enum OCRProvider: String, CaseIterable, Identifiable {
    case deepseekOCR = "DeepSeek-OCR"
    case paddleOCR = "PaddleOCR"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .deepseekOCR: return "DeepSeek-OCR (硅基流动)"
        case .paddleOCR: return "PaddleOCR (百度 AI Studio)"
        }
    }
}

// MARK: - Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    var provider: OCRProvider { get set }
    var apiKey: String? { get set }
    var paddleApiKey: String? { get set }
    var isConfigured: Bool { get }
}

// MARK: - Config Store

final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - DeepSeek-OCR Constants
    
    static let baseURL = "https://api.siliconflow.cn/v1"
    static let model = "deepseek-ai/DeepSeek-OCR"
    
    // MARK: - PaddleOCR Constants (待确认)
    
    static let paddleBaseURL = "https://www.paddleocr.com/api/v1"
    static let paddleModel = "PP-OCRv5"
    
    // MARK: - Published Properties
    
    @Published var provider: OCRProvider {
        didSet { save(provider.rawValue, forKey: .provider) }
    }
    
    @Published var apiKey: String? {
        didSet { save(apiKey, forKey: .deepseekApiKey) }
    }
    
    @Published var paddleApiKey: String? {
        didSet { save(paddleApiKey, forKey: .paddleApiKey) }
    }
    
    // MARK: - Computed Properties
    
    var isConfigured: Bool {
        switch provider {
        case .deepseekOCR:
            return apiKey != nil && !apiKey!.isEmpty
        case .paddleOCR:
            return paddleApiKey != nil && !paddleApiKey!.isEmpty
        }
    }
    
    // MARK: - Init
    
    private init() {
        let providerRaw = UserDefaults.standard.string(forKey: Keys.provider.rawValue)
        self.provider = OCRProvider(rawValue: providerRaw ?? "") ?? .deepseekOCR
        self.apiKey = UserDefaults.standard.string(forKey: Keys.deepseekApiKey.rawValue)
        self.paddleApiKey = UserDefaults.standard.string(forKey: Keys.paddleApiKey.rawValue)
    }
    
    // MARK: - Keys
    
    private enum Keys: String {
        case provider = "ocr_provider"
        case deepseekApiKey = "ocr_deepseek_api_key"
        case paddleApiKey = "ocr_paddle_api_key"
    }
    
    private func save(_ value: String?, forKey key: Keys) {
        UserDefaults.standard.set(value, forKey: key.rawValue)
    }
}
