import SwiftUI
import Combine

// MARK: - Font Scale Level

/// 字体缩放级别
enum FontScaleLevel: String, CaseIterable, Identifiable {
    case extraSmall = "extraSmall"
    case small = "small"
    case medium = "medium"      // 默认
    case large = "large"
    case extraLarge = "extraLarge"
    case accessibility1 = "accessibility1"
    case accessibility2 = "accessibility2"
    
    var id: String { rawValue }
    
    /// 缩放因子
    var scaleFactor: CGFloat {
        switch self {
        case .extraSmall: return 0.8
        case .small: return 0.9
        case .medium: return 1.0
        case .large: return 1.15
        case .extraLarge: return 1.3
        case .accessibility1: return 1.5
        case .accessibility2: return 1.75
        }
    }
    
    /// 显示名称
    var displayName: LocalizedStringKey {
        switch self {
        case .extraSmall: return "Extra Small"
        case .small: return "Small"
        case .medium: return "Medium (Default)"
        case .large: return "Large"
        case .extraLarge: return "Extra Large"
        case .accessibility1: return "Accessibility Large"
        case .accessibility2: return "Accessibility Extra Large"
        }
    }
    
    /// 短名称（用于滑块标签）
    var shortName: String {
        switch self {
        case .extraSmall: return "XS"
        case .small: return "S"
        case .medium: return "M"
        case .large: return "L"
        case .extraLarge: return "XL"
        case .accessibility1: return "A1"
        case .accessibility2: return "A2"
        }
    }
    
    /// 是否为辅助功能大小
    var isAccessibilitySize: Bool {
        switch self {
        case .accessibility1, .accessibility2:
            return true
        default:
            return false
        }
    }
    
    /// 从索引获取级别
    static func from(index: Int) -> FontScaleLevel {
        guard index >= 0 && index < allCases.count else {
            return .medium
        }
        return allCases[index]
    }
    
    /// 获取索引
    var index: Int {
        FontScaleLevel.allCases.firstIndex(of: self) ?? 2
    }
}

// MARK: - Font Scale Manager

/// 字体缩放管理器 - 管理应用内字体大小设置
final class FontScaleManager: ObservableObject {
    static let shared = FontScaleManager()
    
    /// 存储键
    private static let storageKey = "SyncNos.FontScaleLevel"
    
    /// 当前缩放级别
    @Published var scaleLevel: FontScaleLevel {
        didSet {
            UserDefaults.standard.set(scaleLevel.rawValue, forKey: Self.storageKey)
            // 发送通知以便需要手动刷新的视图可以响应
            NotificationCenter.default.post(name: .fontScaleDidChange, object: scaleLevel)
        }
    }
    
    /// 当前缩放因子
    var scaleFactor: CGFloat {
        scaleLevel.scaleFactor
    }
    
    /// 是否为辅助功能大小
    var isAccessibilitySize: Bool {
        scaleLevel.isAccessibilitySize
    }
    
    private init() {
        // 从 UserDefaults 读取保存的设置
        if let savedValue = UserDefaults.standard.string(forKey: Self.storageKey),
           let level = FontScaleLevel(rawValue: savedValue) {
            self.scaleLevel = level
        } else {
            self.scaleLevel = .medium
        }
    }
    
    /// 重置为默认值
    func reset() {
        scaleLevel = .medium
    }
}

// MARK: - Notification Extension

extension Notification.Name {
    static let fontScaleDidChange = Notification.Name("SyncNos.FontScaleDidChange")
}

// MARK: - Environment Key

/// 字体缩放环境键
private struct FontScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1.0
}

extension EnvironmentValues {
    /// 字体缩放因子
    var fontScale: CGFloat {
        get { self[FontScaleKey.self] }
        set { self[FontScaleKey.self] = newValue }
    }
}

// MARK: - View Extension

extension View {
    /// 应用字体缩放因子到视图层级
    func withFontScale(_ scale: CGFloat) -> some View {
        self.environment(\.fontScale, scale)
    }
    
    /// 应用 FontScaleManager 的缩放因子
    func withFontScaleManager(_ manager: FontScaleManager) -> some View {
        self.environment(\.fontScale, manager.scaleFactor)
    }
}

// MARK: - Scaled Font Extension

extension Font {
    /// 创建支持应用内缩放的字体
    /// - Parameters:
    ///   - style: 文本样式
    ///   - scale: 缩放因子
    /// - Returns: 缩放后的字体
    static func scaled(_ style: TextStyle, scale: CGFloat = 1.0) -> Font {
        let baseSize = style.basePointSize
        return .system(size: baseSize * scale)
    }
    
    /// 创建支持应用内缩放的字体（带粗细）
    /// - Parameters:
    ///   - style: 文本样式
    ///   - weight: 字体粗细
    ///   - scale: 缩放因子
    /// - Returns: 缩放后的字体
    static func scaled(_ style: TextStyle, weight: Weight, scale: CGFloat = 1.0) -> Font {
        let baseSize = style.basePointSize
        return .system(size: baseSize * scale, weight: weight)
    }
    
    /// 创建支持应用内缩放的字体（带设计）
    /// - Parameters:
    ///   - style: 文本样式
    ///   - weight: 字体粗细
    ///   - design: 字体设计
    ///   - scale: 缩放因子
    /// - Returns: 缩放后的字体
    static func scaled(_ style: TextStyle, weight: Weight, design: Design, scale: CGFloat = 1.0) -> Font {
        let baseSize = style.basePointSize
        return .system(size: baseSize * scale, weight: weight, design: design)
    }
}

// MARK: - TextStyle Base Size

extension Font.TextStyle {
    /// 基础点大小（macOS 默认值）
    var basePointSize: CGFloat {
        switch self {
        case .largeTitle: return 26
        case .title: return 22
        case .title2: return 17
        case .title3: return 15
        case .headline: return 13
        case .subheadline: return 11
        case .body: return 13
        case .callout: return 12
        case .footnote: return 10
        case .caption: return 10
        case .caption2: return 10
        @unknown default: return 13
        }
    }
}

// MARK: - ScaledFont View Modifier

/// 应用缩放字体的视图修饰符
struct ScaledFontModifier: ViewModifier {
    @Environment(\.fontScale) private var fontScale
    let style: Font.TextStyle
    let weight: Font.Weight?
    let design: Font.Design?
    
    init(style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil) {
        self.style = style
        self.weight = weight
        self.design = design
    }
    
    func body(content: Content) -> some View {
        let baseSize = style.basePointSize
        let scaledSize = baseSize * fontScale
        
        if let weight = weight, let design = design {
            content.font(.system(size: scaledSize, weight: weight, design: design))
        } else if let weight = weight {
            content.font(.system(size: scaledSize, weight: weight))
        } else {
            content.font(.system(size: scaledSize))
        }
    }
}

extension View {
    /// 应用支持应用内缩放的字体
    /// - Parameters:
    ///   - style: 文本样式
    ///   - weight: 字体粗细（可选）
    ///   - design: 字体设计（可选）
    /// - Returns: 修改后的视图
    func scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil) -> some View {
        modifier(ScaledFontModifier(style: style, weight: weight, design: design))
    }
}

// MARK: - Preview

#Preview("Font Scale Levels") {
    VStack(alignment: .leading, spacing: 16) {
        ForEach(FontScaleLevel.allCases) { level in
            HStack {
                Text(level.displayName)
                    .font(.system(size: 13 * level.scaleFactor))
                Spacer()
                Text("\(Int(level.scaleFactor * 100))%")
                    .foregroundColor(.secondary)
            }
        }
    }
    .padding()
    .frame(width: 300)
}

