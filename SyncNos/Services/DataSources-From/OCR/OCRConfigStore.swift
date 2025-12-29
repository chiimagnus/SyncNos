import Foundation

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    /// Vision OCR 始终可用
    var isConfigured: Bool { get }
}

// MARK: - OCR Config Store

/// OCR 配置存储
/// 使用 Apple Vision 框架，无需配置
final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - Computed Properties
    
    /// Vision OCR 始终可用
    var isConfigured: Bool { true }
    
    // MARK: - Init
    
    private init() {}
}
