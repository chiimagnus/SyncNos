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
/// 
/// macOS 不支持系统级 Dynamic Type，因此我们使用此管理器实现应用内字体缩放。
/// 
/// ## 使用方法
/// 
/// ### 1. 在根视图应用缩放
/// ```swift
/// RootView()
///     .applyFontScale()
/// ```
/// 
/// ### 2. 在视图中使用缩放字体
/// ```swift
/// // 方式一：使用 .scaledFont() 修饰符
/// Text("Hello")
///     .scaledFont(.headline)
/// 
/// // 方式二：使用 ScaledText 视图
/// ScaledText("Hello", style: .headline)
/// ```
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
    /// 字体缩放因子 - 通过 .applyFontScale() 注入到视图层级
    var fontScale: CGFloat {
        get { self[FontScaleKey.self] }
        set { self[FontScaleKey.self] = newValue }
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

// MARK: - Scaled Font Modifier

/// 应用缩放字体的视图修饰符
/// 
/// 自动从环境中读取 fontScale 并应用到字体大小
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

// MARK: - View Extensions

extension View {
    /// 应用 FontScaleManager 的缩放因子到整个视图层级
    /// 
    /// 应在应用的根视图上调用此方法：
    /// ```swift
    /// RootView()
    ///     .applyFontScale()
    /// ```
    func applyFontScale() -> some View {
        modifier(AppFontScaleModifier())
    }
    
    /// 应用支持应用内缩放的字体
    /// 
    /// ```swift
    /// Text("Hello")
    ///     .scaledFont(.headline)
    /// 
    /// Text("World")
    ///     .scaledFont(.body, weight: .bold)
    /// ```
    func scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil) -> some View {
        modifier(ScaledFontModifier(style: style, weight: weight, design: design))
    }
}

/// 应用字体缩放到整个视图层级的修饰符
struct AppFontScaleModifier: ViewModifier {
    @ObservedObject var fontScaleManager = FontScaleManager.shared
    
    func body(content: Content) -> some View {
        content
            .environment(\.fontScale, fontScaleManager.scaleFactor)
    }
}

// MARK: - ScaledText View

/// 支持应用内缩放的文本视图
/// 
/// 使用示例：
/// ```swift
/// ScaledText("Hello World", style: .headline)
/// ScaledText("Bold Text", style: .body, weight: .bold)
/// ```
struct ScaledText: View {
    @Environment(\.fontScale) private var fontScale
    
    let text: LocalizedStringKey
    let style: Font.TextStyle
    let weight: Font.Weight?
    let design: Font.Design?
    
    init(_ text: LocalizedStringKey, style: Font.TextStyle = .body, weight: Font.Weight? = nil, design: Font.Design? = nil) {
        self.text = text
        self.style = style
        self.weight = weight
        self.design = design
    }
    
    init(_ text: String, style: Font.TextStyle = .body, weight: Font.Weight? = nil, design: Font.Design? = nil) {
        self.text = LocalizedStringKey(text)
        self.style = style
        self.weight = weight
        self.design = design
    }
    
    var body: some View {
        let baseSize = style.basePointSize
        let scaledSize = baseSize * fontScale
        
        if let weight = weight, let design = design {
            Text(text)
                .font(.system(size: scaledSize, weight: weight, design: design))
        } else if let weight = weight {
            Text(text)
                .font(.system(size: scaledSize, weight: weight))
        } else {
            Text(text)
                .font(.system(size: scaledSize))
        }
    }
}

// MARK: - Adaptive Stack

/// 响应式布局容器：根据字体缩放级别自动切换水平/垂直布局
/// 
/// 当字体缩放达到辅助功能大小时，自动从水平布局切换为垂直布局
struct AdaptiveStack<Content: View>: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    let horizontalAlignment: VerticalAlignment
    let verticalAlignment: HorizontalAlignment
    let spacing: CGFloat?
    let content: Content
    
    init(
        horizontalAlignment: VerticalAlignment = .center,
        verticalAlignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.horizontalAlignment = horizontalAlignment
        self.verticalAlignment = verticalAlignment
        self.spacing = spacing
        self.content = content()
    }
    
    var body: some View {
        if fontScaleManager.isAccessibilitySize {
            VStack(alignment: verticalAlignment, spacing: spacing) {
                content
            }
        } else {
            HStack(alignment: horizontalAlignment, spacing: spacing) {
                content
            }
        }
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

#Preview("ScaledText") {
    VStack(alignment: .leading, spacing: 8) {
        ScaledText("Large Title", style: .largeTitle)
        ScaledText("Title", style: .title)
        ScaledText("Headline", style: .headline, weight: .bold)
        ScaledText("Body", style: .body)
        ScaledText("Caption", style: .caption)
    }
    .padding()
    .applyFontScale()
}
