import Foundation
import SwiftUI

// MARK: - OCR Language Mode

/// OCR 语言检测模式
enum OCRLanguageMode: String, CaseIterable, Codable {
    /// 自动检测语言（推荐）
    case automatic = "automatic"
    /// 手动选择语言
    case manual = "manual"
    
    var displayName: String {
        switch self {
        case .automatic:
            return String(localized: "Automatic Detection")
        case .manual:
            return String(localized: "Manual Selection")
        }
    }
    
    var description: String {
        switch self {
        case .automatic:
            return String(localized: "Vision will automatically detect languages in the image")
        case .manual:
            return String(localized: "Select specific languages for better accuracy")
        }
    }
}

// MARK: - OCR Language

/// 支持的 OCR 语言
/// 语言列表来自 VNRecognizeTextRequest.supportedRecognitionLanguages() (macOS 14, Revision 3)
struct OCRLanguage: Identifiable, Hashable, Codable {
    let code: String
    let name: String
    let localizedName: String
    
    var id: String { code }
    
    // MARK: - Predefined Languages (Official list from Vision framework)
    
    /// 所有官方支持的语言（来自 VNRecognizeTextRequest.supportedRecognitionLanguages()）
    /// 共 30 种语言
    static let allSupported: [OCRLanguage] = [
        // 东亚语言
        OCRLanguage(code: "zh-Hans", name: "Chinese (Simplified)", localizedName: "中文（简体）"),
        OCRLanguage(code: "zh-Hant", name: "Chinese (Traditional)", localizedName: "中文（繁體）"),
        OCRLanguage(code: "yue-Hans", name: "Cantonese (Simplified)", localizedName: "粵語（简体）"),
        OCRLanguage(code: "yue-Hant", name: "Cantonese (Traditional)", localizedName: "粵語（繁體）"),
        OCRLanguage(code: "ja-JP", name: "Japanese", localizedName: "日本語"),
        OCRLanguage(code: "ko-KR", name: "Korean", localizedName: "한국어"),
        
        // 西欧语言
        OCRLanguage(code: "en-US", name: "English", localizedName: "English"),
        OCRLanguage(code: "fr-FR", name: "French", localizedName: "Français"),
        OCRLanguage(code: "de-DE", name: "German", localizedName: "Deutsch"),
        OCRLanguage(code: "es-ES", name: "Spanish", localizedName: "Español"),
        OCRLanguage(code: "it-IT", name: "Italian", localizedName: "Italiano"),
        OCRLanguage(code: "pt-BR", name: "Portuguese (Brazil)", localizedName: "Português (Brasil)"),
        OCRLanguage(code: "nl-NL", name: "Dutch", localizedName: "Nederlands"),
        
        // 东欧语言
        OCRLanguage(code: "ru-RU", name: "Russian", localizedName: "Русский"),
        OCRLanguage(code: "uk-UA", name: "Ukrainian", localizedName: "Українська"),
        OCRLanguage(code: "pl-PL", name: "Polish", localizedName: "Polski"),
        OCRLanguage(code: "cs-CZ", name: "Czech", localizedName: "Čeština"),
        OCRLanguage(code: "ro-RO", name: "Romanian", localizedName: "Română"),
        
        // 北欧语言
        OCRLanguage(code: "sv-SE", name: "Swedish", localizedName: "Svenska"),
        OCRLanguage(code: "da-DK", name: "Danish", localizedName: "Dansk"),
        OCRLanguage(code: "no-NO", name: "Norwegian", localizedName: "Norsk"),
        OCRLanguage(code: "nb-NO", name: "Norwegian Bokmål", localizedName: "Norsk bokmål"),
        OCRLanguage(code: "nn-NO", name: "Norwegian Nynorsk", localizedName: "Norsk nynorsk"),
        
        // 东南亚语言
        OCRLanguage(code: "th-TH", name: "Thai", localizedName: "ไทย"),
        OCRLanguage(code: "vi-VT", name: "Vietnamese", localizedName: "Tiếng Việt"),
        OCRLanguage(code: "id-ID", name: "Indonesian", localizedName: "Bahasa Indonesia"),
        OCRLanguage(code: "ms-MY", name: "Malay", localizedName: "Bahasa Melayu"),
        
        // 中东语言
        OCRLanguage(code: "ar-SA", name: "Arabic", localizedName: "العربية"),
        OCRLanguage(code: "ars-SA", name: "Arabic (Najdi)", localizedName: "العربية النجدية"),
        OCRLanguage(code: "tr-TR", name: "Turkish", localizedName: "Türkçe"),
    ]
    
    /// 根据代码查找语言
    static func find(by code: String) -> OCRLanguage? {
        allSupported.first { $0.code == code }
    }
    
    /// 获取语言分类
    static func groupedLanguages() -> [(String, [OCRLanguage])] {
        [
            ("East Asian", allSupported.filter { ["zh-Hans", "zh-Hant", "yue-Hans", "yue-Hant", "ja-JP", "ko-KR"].contains($0.code) }),
            ("Western European", allSupported.filter { ["en-US", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "nl-NL"].contains($0.code) }),
            ("Eastern European", allSupported.filter { ["ru-RU", "uk-UA", "pl-PL", "cs-CZ", "ro-RO"].contains($0.code) }),
            ("Nordic", allSupported.filter { ["sv-SE", "da-DK", "no-NO", "nb-NO", "nn-NO"].contains($0.code) }),
            ("Southeast Asian", allSupported.filter { ["th-TH", "vi-VT", "id-ID", "ms-MY"].contains($0.code) }),
            ("Middle Eastern", allSupported.filter { ["ar-SA", "ars-SA", "tr-TR"].contains($0.code) }),
        ]
    }
}

// MARK: - OCR Config Store Protocol

protocol OCRConfigStoreProtocol: AnyObject {
    /// Vision OCR 始终可用
    var isConfigured: Bool { get }
    
    /// 当前语言模式
    var languageMode: OCRLanguageMode { get set }
    
    /// 手动选择的语言代码
    var selectedLanguageCodes: [String] { get set }
    
    /// 获取当前生效的语言代码列表
    var effectiveLanguageCodes: [String] { get }
    
    /// 是否启用自动语言检测
    var isAutoDetectEnabled: Bool { get }
}

// MARK: - OCR Config Store

/// OCR 配置存储
/// 使用 Apple Vision 框架，支持语言配置
final class OCRConfigStore: OCRConfigStoreProtocol, ObservableObject {
    static let shared = OCRConfigStore()
    
    // MARK: - Keys
    
    private enum Keys {
        static let languageMode = "ocr.languageMode"
        static let selectedLanguageCodes = "ocr.selectedLanguageCodes"
    }
    
    // MARK: - Default Languages
    
    /// 默认语言（自动模式下作为优先级提示）
    private static let defaultLanguageCodes = ["zh-Hans", "zh-Hant", "en-US"]
    
    // MARK: - Published Properties
    
    /// 语言模式
    @Published var languageMode: OCRLanguageMode {
        didSet {
            UserDefaults.standard.set(languageMode.rawValue, forKey: Keys.languageMode)
        }
    }
    
    /// 手动选择的语言代码
    @Published var selectedLanguageCodes: [String] {
        didSet {
            UserDefaults.standard.set(selectedLanguageCodes, forKey: Keys.selectedLanguageCodes)
        }
    }
    
    // MARK: - Computed Properties
    
    /// Vision OCR 始终可用
    var isConfigured: Bool { true }
    
    /// 是否启用自动语言检测
    var isAutoDetectEnabled: Bool {
        languageMode == .automatic
    }
    
    /// 获取当前生效的语言代码列表
    var effectiveLanguageCodes: [String] {
        switch languageMode {
        case .automatic:
            // 自动模式下使用默认语言作为优先级提示
            return Self.defaultLanguageCodes
        case .manual:
            // 手动模式下使用用户选择的语言
            return selectedLanguageCodes.isEmpty 
                ? Self.defaultLanguageCodes 
                : selectedLanguageCodes
        }
    }
    
    /// 获取当前选中的语言对象
    var selectedLanguages: [OCRLanguage] {
        selectedLanguageCodes.compactMap { OCRLanguage.find(by: $0) }
    }
    
    // MARK: - Init
    
    private init() {
        // 从 UserDefaults 读取配置
        if let modeRaw = UserDefaults.standard.string(forKey: Keys.languageMode),
           let mode = OCRLanguageMode(rawValue: modeRaw) {
            self.languageMode = mode
        } else {
            self.languageMode = .automatic
        }
        
        if let codes = UserDefaults.standard.array(forKey: Keys.selectedLanguageCodes) as? [String] {
            self.selectedLanguageCodes = codes
        } else {
            // 初始化为空，让用户自己选择
            self.selectedLanguageCodes = []
        }
    }
    
    // MARK: - Methods
    
    /// 添加语言
    func addLanguage(_ code: String) {
        guard !selectedLanguageCodes.contains(code) else { return }
        selectedLanguageCodes.append(code)
    }
    
    /// 移除语言
    func removeLanguage(_ code: String) {
        selectedLanguageCodes.removeAll { $0 == code }
    }
    
    /// 切换语言选中状态
    func toggleLanguage(_ code: String) {
        if selectedLanguageCodes.contains(code) {
            removeLanguage(code)
        } else {
            addLanguage(code)
        }
    }
    
    /// 重置为默认配置
    func resetToDefaults() {
        languageMode = .automatic
        selectedLanguageCodes = []
    }
}
