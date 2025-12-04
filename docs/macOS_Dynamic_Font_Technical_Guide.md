# macOS 动态字体技术指南

## 概述

本文档详细介绍了 macOS 平台上的字体缩放机制，以及 SyncNos 应用如何实现自定义的应用内字体缩放功能。

## 目录

1. [macOS 与 iOS 动态字体的差异](#macos-与-ios-动态字体的差异)
2. [macOS 系统字体设置](#macos-系统字体设置)
3. [SwiftUI 内置 API 的局限性](#swiftui-内置-api-的局限性)
4. [SyncNos 自定义字体缩放方案](#syncnos-自定义字体缩放方案)
5. [实现细节](#实现细节)
6. [最佳实践](#最佳实践)
7. [参考资源](#参考资源)

---

## macOS 与 iOS 动态字体的差异

### iOS/iPadOS Dynamic Type

在 iOS 和 iPadOS 上，Apple 提供了完整的 **Dynamic Type** 系统：

- **系统级支持**：用户可以在「设置 → 显示与亮度 → 文字大小」中调整
- **自动响应**：使用系统文本样式（如 `.body`、`.headline`）的文本会自动响应
- **SwiftUI 支持**：`@ScaledMetric` 和 `DynamicTypeSize` 环境值可以正常工作
- **辅助功能**：支持更大的辅助功能字体大小

```swift
// iOS 上可以正常工作
@ScaledMetric(relativeTo: .body) var iconSize: CGFloat = 20
@Environment(\.dynamicTypeSize) var dynamicTypeSize

Text("Hello")
    .font(.body)  // 自动响应系统字体大小设置
```

### macOS 的情况

macOS 的字体缩放机制与 iOS 有本质区别：

1. **没有系统级 Dynamic Type**：macOS 传统上不支持类似 iOS 的动态字体系统
2. **macOS Sonoma 新增功能**：macOS 14+ 在「系统设置 → 辅助功能 → 显示 → 文字大小」中新增了文字大小设置
3. **SwiftUI API 不响应**：`@ScaledMetric` 和 `DynamicTypeSize` **不会**响应 macOS 的文字大小设置
4. **仅部分应用支持**：只有明确适配的应用才会出现在系统文字大小设置列表中

### macOS Sonoma 文字大小设置

macOS Sonoma (14.0+) 引入了新的文字大小设置：

- **位置**：系统设置 → 辅助功能 → 显示 → 文字大小
- **功能**：允许用户为支持的应用单独设置字体大小
- **限制**：
  - 只有特定应用会出现在列表中
  - 需要应用明确支持此功能
  - SwiftUI 的 `@ScaledMetric` 和 `DynamicTypeSize` 不会自动响应

---

## macOS 系统字体设置

### 系统设置位置

1. **辅助功能 → 显示 → 文字大小**（macOS Sonoma+）
   - 可为支持的应用单独设置字体大小
   - 使用滑块调整首选阅读字体大小

2. **显示 → 分辨率**
   - 通过调整分辨率间接影响 UI 缩放
   - 影响整个系统界面，不仅仅是文字

### NSFont API

macOS 提供了一些字体相关的 API：

```swift
// 获取系统首选字体
let font = NSFont.preferredFont(forTextStyle: .body)

// 监听系统外观变化（不包括字体大小）
NotificationCenter.default.addObserver(
    forName: NSApplication.didChangeScreenParametersNotification,
    object: nil,
    queue: .main
) { _ in
    // 处理显示参数变化
}
```

> **注意**：`NSFont.preferredFont(forTextStyle:)` 返回的字体大小在 macOS 上是固定的，不会响应系统文字大小设置。

---

## SwiftUI 内置 API 的局限性

### @ScaledMetric

```swift
// 在 macOS 上，这个值始终保持不变
@ScaledMetric(relativeTo: .body) var iconSize: CGFloat = 20
```

- **iOS**：根据 Dynamic Type 设置自动缩放
- **macOS**：始终返回初始值，不响应任何系统设置

### DynamicTypeSize

```swift
@Environment(\.dynamicTypeSize) var dynamicTypeSize

// 在 macOS 上，这个值始终是 .large（默认值）
if dynamicTypeSize.isAccessibilitySize {
    // 在 macOS 上永远不会执行
}
```

- **iOS**：反映当前系统 Dynamic Type 设置
- **macOS**：始终返回 `.large`，不响应系统文字大小设置

### 系统文本样式

```swift
Text("Hello")
    .font(.body)
    .font(.headline)
    .font(.title)
```

- **iOS**：字体大小根据 Dynamic Type 设置自动调整
- **macOS**：字体大小固定，不响应系统文字大小设置

---

## SyncNos 自定义字体缩放方案

由于 macOS 不支持系统级 Dynamic Type，SyncNos 实现了自定义的应用内字体缩放功能。

### 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    FontScaleManager                          │
│  - 单例模式管理全局字体缩放状态                               │
│  - 持久化用户设置到 UserDefaults                             │
│  - 发布 @Published 属性供视图订阅                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Environment\.fontScale                       │
│  - 自定义环境键传递缩放因子                                   │
│  - 通过 .applyFontScale() 注入到视图层级                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    视图使用方式                               │
│  - .scaledFont(.headline) 修饰符                             │
│  - ScaledText("Hello", style: .body) 视图                   │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

1. **FontScaleLevel**：定义离散的字体缩放级别
2. **FontScaleManager**：管理全局字体缩放状态
3. **ScaledFontModifier**：应用缩放字体的视图修饰符
4. **TextSizeSettingsView**：用户设置界面

---

## 实现细节

### 1. FontScaleLevel 枚举

定义了 7 个离散的字体缩放级别：

```swift
enum FontScaleLevel: String, CaseIterable, Identifiable {
    case extraSmall = "extraSmall"    // 0.8x
    case small = "small"              // 0.9x
    case medium = "medium"            // 1.0x (默认)
    case large = "large"              // 1.15x
    case extraLarge = "extraLarge"    // 1.3x
    case accessibility1 = "accessibility1"  // 1.5x
    case accessibility2 = "accessibility2"  // 1.75x
    
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
    
    var isAccessibilitySize: Bool {
        switch self {
        case .accessibility1, .accessibility2: return true
        default: return false
        }
    }
}
```

### 2. FontScaleManager

全局字体缩放管理器：

```swift
final class FontScaleManager: ObservableObject {
    static let shared = FontScaleManager()
    
    @Published var scaleLevel: FontScaleLevel {
        didSet {
            UserDefaults.standard.set(scaleLevel.rawValue, forKey: "SyncNos.FontScaleLevel")
            NotificationCenter.default.post(name: .fontScaleDidChange, object: scaleLevel)
        }
    }
    
    var scaleFactor: CGFloat { scaleLevel.scaleFactor }
    var isAccessibilitySize: Bool { scaleLevel.isAccessibilitySize }
    
    private init() {
        if let saved = UserDefaults.standard.string(forKey: "SyncNos.FontScaleLevel"),
           let level = FontScaleLevel(rawValue: saved) {
            self.scaleLevel = level
        } else {
            self.scaleLevel = .medium
        }
    }
    
    func reset() { scaleLevel = .medium }
}
```

### 3. 自定义环境键

```swift
private struct FontScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1.0
}

extension EnvironmentValues {
    var fontScale: CGFloat {
        get { self[FontScaleKey.self] }
        set { self[FontScaleKey.self] = newValue }
    }
}
```

### 4. 文本样式基础大小

定义 macOS 上各文本样式的基础点大小：

```swift
extension Font.TextStyle {
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
```

### 5. ScaledFontModifier

视图修饰符，自动从环境读取缩放因子：

```swift
struct ScaledFontModifier: ViewModifier {
    @Environment(\.fontScale) private var fontScale
    let style: Font.TextStyle
    let weight: Font.Weight?
    let design: Font.Design?
    
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
    func scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design? = nil) -> some View {
        modifier(ScaledFontModifier(style: style, weight: weight, design: design))
    }
}
```

### 6. 应用字体缩放到视图层级

```swift
struct AppFontScaleModifier: ViewModifier {
    @ObservedObject var fontScaleManager = FontScaleManager.shared
    
    func body(content: Content) -> some View {
        content.environment(\.fontScale, fontScaleManager.scaleFactor)
    }
}

extension View {
    func applyFontScale() -> some View {
        modifier(AppFontScaleModifier())
    }
}
```

---

## 最佳实践

### 1. 在根视图应用字体缩放

```swift
// SyncNosApp.swift 或 RootView.swift
var body: some View {
    RootView()
        .applyFontScale()
}
```

### 2. 使用 .scaledFont() 替代 .font()

```swift
// ❌ 不推荐：不会响应字体缩放
Text("Hello")
    .font(.headline)

// ✅ 推荐：会响应字体缩放
Text("Hello")
    .scaledFont(.headline)

// ✅ 带粗细
Text("Hello")
    .scaledFont(.headline, weight: .bold)

// ✅ 带设计（如等宽字体）
Text("Hello")
    .scaledFont(.body, weight: .regular, design: .monospaced)
```

### 3. 两种获取缩放因子的方式

根据使用场景选择合适的方式：

#### 方式一：使用 `@Environment(\.fontScale)`

适用于：
- 视图已经通过 `.applyFontScale()` 注入了环境值
- 只需要读取缩放因子，不需要观察变化
- 用于 `.scaledFont()` 修饰符内部

```swift
struct MyView: View {
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        // 用于特殊字体（如等宽字体）
        Text("Code")
            .font(.system(size: Font.TextStyle.caption.basePointSize * fontScale, design: .monospaced))
    }
}
```

#### 方式二：使用 `@ObservedObject private var fontScaleManager`

适用于：
- 需要直接访问 `FontScaleManager.shared`
- 需要用于计算属性（computed properties）
- 用于图标/布局尺寸缩放

```swift
struct MyView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    private var iconSize: CGFloat { 40 * fontScaleManager.scaleFactor }
    
    var body: some View {
        Image(systemName: "star")
            .font(.system(size: iconSize))
    }
}
```

### 4. 图标和布局尺寸缩放

图标和布局元素应该使用 `fontScaleManager.scaleFactor` 进行手动缩放：

```swift
@ObservedObject private var fontScaleManager = FontScaleManager.shared

// 图标大小
Image(systemName: "books.vertical")
    .font(.system(size: 40 * fontScaleManager.scaleFactor))

// 布局尺寸
let logoSize: CGFloat = 120 * fontScaleManager.scaleFactor
Image("Logo")
    .frame(width: logoSize, height: logoSize)
```

### 5. 响应式布局

使用 `AdaptiveStack` 在辅助功能字体大小时自动切换布局：

```swift
AdaptiveStack(horizontalAlignment: .center, spacing: 16) {
    Image(systemName: "star")
    Text("Featured")
}
// 正常字体：水平排列
// 辅助功能字体：垂直排列
```

或手动检查：

```swift
@ObservedObject private var fontScaleManager = FontScaleManager.shared

var body: some View {
    if fontScaleManager.isAccessibilitySize {
        VStack { content }
    } else {
        HStack { content }
    }
}
```

### 6. 避免使用 @ScaledMetric

```swift
// ❌ 在 macOS 上不工作
@ScaledMetric(relativeTo: .body) var iconSize: CGFloat = 20

// ✅ 使用 FontScaleManager
@ObservedObject private var fontScaleManager = FontScaleManager.shared
let iconSize = 20 * fontScaleManager.scaleFactor
```

### 7. 避免使用 DynamicTypeSize

```swift
// ❌ 在 macOS 上始终返回 .large
@Environment(\.dynamicTypeSize) var dynamicTypeSize
if dynamicTypeSize.isAccessibilitySize { ... }

// ✅ 使用 FontScaleManager
@ObservedObject private var fontScaleManager = FontScaleManager.shared
if fontScaleManager.isAccessibilitySize { ... }
```

### 8. 特殊字体（等宽字体等）

对于需要特殊设计的字体（如等宽字体），使用手动计算：

```swift
@Environment(\.fontScale) private var fontScale

// 等宽字体
Text("func main()")
    .font(.system(size: Font.TextStyle.caption.basePointSize * fontScale, design: .monospaced))
```

---

## 文件结构

```
SyncNos/
├── Services/Core/
│   └── FontScaleManager.swift      # 核心字体缩放逻辑
│       ├── FontScaleLevel          # 缩放级别枚举
│       ├── FontScaleManager        # 全局管理器
│       ├── FontScaleKey            # 环境键
│       ├── ScaledFontModifier      # 视图修饰符
│       ├── ScaledText              # 文本视图
│       └── AdaptiveStack           # 响应式布局容器
└── Views/
    ├── RootView.swift              # 根视图（应用 .applyFontScale()）
    ├── Components/
    │   ├── MainListView.swift      # 主列表视图
    │   ├── SwipeableDataSourceContainer.swift
    │   ├── HighlightCardView.swift
    │   ├── InfoHeaderCardView.swift
    │   ├── ArticleContentCardView.swift
    │   ├── SelectionPlaceholderView.swift
    │   ├── SyncQueueView.swift
    │   ├── DataSourceIndicatorBar.swift
    │   └── MenuBarView.swift
    ├── AppleBooks/
    │   ├── AppleBooksListView.swift
    │   └── AppleBooksDetailView.swift
    ├── GoodLinks/
    │   ├── GoodLinksListView.swift
    │   └── GoodLinksDetailView.swift
    ├── WeRead/
    │   ├── WeReadListView.swift
    │   └── WeReadDetailView.swift
    ├── Dedao/
    │   ├── DedaoListView.swift
    │   └── DedaoDetailView.swift
    └── Settting/
        ├── General/
        │   ├── SettingsView.swift          # 设置主视图
        │   ├── TextSizeSettingsView.swift  # 字体大小设置界面
        │   ├── LanguageView.swift
        │   ├── AboutView.swift
        │   ├── AppleAccountView.swift
        │   └── LogWindow.swift
        ├── SyncTo/
        │   └── NotionIntegrationView.swift
        ├── SyncFrom/
        │   ├── AppleBooksSettingsView.swift
        │   ├── GoodLinksSettingsView.swift
        │   ├── WeReadSettingsView.swift
        │   └── DedaoSettingsView.swift
        ├── IAPViews/
        │   ├── PayWallView.swift
        │   └── IAPView.swift
        └── Onboarding/
            ├── OnboardingWelcomeView.swift
            ├── OnboardingSourcesView.swift
            ├── OnboardingNotionView.swift
            └── OnboardingComponents.swift
```

---

## 参考资源

### Apple 官方文档

- [Typography - Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/typography)
- [NSFont - AppKit](https://developer.apple.com/documentation/appkit/nsfont)
- [Font - SwiftUI](https://developer.apple.com/documentation/swiftui/font)

### WWDC 视频

- [WWDC 2024: Get started with Dynamic Type](https://developer.apple.com/videos/play/wwdc2024/10073/)
  - 主要针对 iOS/iPadOS，但提供了 Dynamic Type 的设计原则
  - 介绍了文本样式、辅助功能大小等概念

### 相关技术

- [Environment Values - SwiftUI](https://developer.apple.com/documentation/swiftui/environmentvalues)
- [ViewModifier - SwiftUI](https://developer.apple.com/documentation/swiftui/viewmodifier)
- [ObservableObject - Combine](https://developer.apple.com/documentation/combine/observableobject)

---

## 总结

| 特性 | iOS/iPadOS | macOS |
|------|-----------|-------|
| 系统 Dynamic Type | ✅ 完整支持 | ❌ 不支持 |
| @ScaledMetric | ✅ 正常工作 | ❌ 不响应 |
| DynamicTypeSize | ✅ 正常工作 | ❌ 始终返回 .large |
| 系统文字大小设置 | ✅ 设置 → 显示 | ⚠️ 辅助功能（Sonoma+，仅部分应用） |
| SwiftUI .font(.body) 响应系统设置 | ✅ 是 | ❌ 否 |
| 推荐方案 | 使用系统 API | **自定义字体缩放** |

**关键结论**：在 macOS 上，如果需要支持用户自定义字体大小，必须实现自定义的字体缩放机制，因为 SwiftUI 的内置 Dynamic Type API 在 macOS 上不会响应系统设置。

---

*文档版本：1.0*  
*最后更新：2025年12月*  
*适用于：SyncNos macOS 应用*

