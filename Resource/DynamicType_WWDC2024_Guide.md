# Dynamic Type 完整开发指南

> 基于 WWDC 2024 Session 10074: Get started with Dynamic Type

## 目录

1. [概述](#概述)
2. [为什么需要 Dynamic Type](#为什么需要-dynamic-type)
3. [用户如何设置文本大小](#用户如何设置文本大小)
4. [使用系统文本样式](#使用系统文本样式)
5. [动态布局适配](#动态布局适配)
6. [图片与符号的处理](#图片与符号的处理)
7. [大内容查看器 (Large Content Viewer)](#大内容查看器-large-content-viewer)
8. [测试与调试](#测试与调试)
9. [最佳实践清单](#最佳实践清单)
10. [相关资源](#相关资源)

---

## 概述

**Dynamic Type（动态字体）** 是 Apple 平台上的一项核心辅助功能，允许用户在系统和应用中自定义文本显示大小。这项功能对于视觉可访问性至关重要，因为大多数内容都是通过文本传达的。

### 核心价值

- **可访问性**：满足不同用户对文本大小的需求
- **跨平台适配**：构建适应任何屏幕尺寸、方向和平台的界面
- **用户体验**：提供舒适的阅读体验，提升应用的可用性

### 支持平台

- iOS / iPadOS
- macOS
- watchOS
- tvOS
- visionOS

---

## 为什么需要 Dynamic Type

### 用户需求多样性

不同用户可能因为以下原因需要不同的文本大小：

| 用户群体 | 需求说明 |
|---------|---------|
| 视力障碍用户 | 需要更大的文本以便阅读 |
| 老年用户 | 可能偏好较大的文本 |
| 近视/远视用户 | 根据视力情况调整 |
| 不同设备使用场景 | 在床上、户外等不同环境下阅读 |
| 个人偏好 | 纯粹的个人舒适度选择 |

### 开发者收益

1. **更广泛的用户覆盖**：支持 Dynamic Type 意味着更多用户能够使用你的应用
2. **响应式设计基础**：动态 UI 天然适配不同屏幕和设备
3. **App Store 审核加分**：良好的可访问性支持是高质量应用的标志
4. **法规合规**：某些地区和行业对可访问性有法规要求

---

## 用户如何设置文本大小

### 设置路径

```
设置 → 辅助功能 → 显示与文字大小 → 更大字体
```

### 可用的文本大小

| 类别 | 大小数量 | 说明 |
|-----|---------|-----|
| 标准大小 | 7 种 | 默认可用 |
| 辅助功能大小 | 5 种 | 启用"更大的辅助功能字体"后可用 |
| **总计** | **12 种** | 从 xSmall 到 AX5 |

### 文本大小枚举 (DynamicTypeSize)

```swift
public enum DynamicTypeSize: Hashable, Comparable, CaseIterable {
    // 标准大小
    case xSmall
    case small
    case medium
    case large          // 默认大小
    case xLarge
    case xxLarge
    case xxxLarge
    
    // 辅助功能大小
    case accessibility1  // AX1
    case accessibility2  // AX2
    case accessibility3  // AX3
    case accessibility4  // AX4
    case accessibility5  // AX5
    
    /// 判断是否为辅助功能大小
    public var isAccessibilitySize: Bool
}
```

### 控制中心快捷访问

用户可以将文本大小控制添加到控制中心，实现快速调整：

```
设置 → 控制中心 → 添加"文字大小"
```

---

## 使用系统文本样式

### 核心原则

> ⚠️ **重要**：使用系统提供的文本样式，而不是固定字体大小！

系统文本样式会自动响应用户的 Dynamic Type 设置，同时保持内容的视觉层级。

### 可用的文本样式

| 样式 | 用途 | SwiftUI | UIKit |
|-----|-----|---------|-------|
| Large Title | 大标题 | `.largeTitle` | `.largeTitle` |
| Title | 标题 | `.title` | `.title1` |
| Title 2 | 二级标题 | `.title2` | `.title2` |
| Title 3 | 三级标题 | `.title3` | `.title3` |
| Headline | 强调文本 | `.headline` | `.headline` |
| Body | 正文（默认） | `.body` | `.body` |
| Callout | 标注 | `.callout` | `.callout` |
| Subheadline | 副标题 | `.subheadline` | `.subheadline` |
| Footnote | 脚注 | `.footnote` | `.footnote` |
| Caption | 说明文字 | `.caption` | `.caption1` |
| Caption 2 | 次要说明 | `.caption2` | `.caption2` |

### SwiftUI 实现

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 使用系统文本样式
            Text("大标题")
                .font(.largeTitle)
            
            Text("标题")
                .font(.title)
            
            Text("正文内容，这是应用中最常用的文本样式，适合长段落阅读。")
                .font(.body)
            
            Text("说明文字")
                .font(.caption)
        }
        .padding()
    }
}
```

### UIKit 实现

```swift
import UIKit

class ViewController: UIViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        let label = UILabel()
        
        // ✅ 关键设置：启用自动字体调整
        label.adjustsFontForContentSizeCategory = true
        
        // 使用系统文本样式
        label.font = .preferredFont(forTextStyle: .title1)
        
        // 允许多行显示，避免截断
        label.numberOfLines = 0
        
        label.text = "Hello, World!"
        
        view.addSubview(label)
    }
}
```

### 自定义字体 + Dynamic Type

如果需要使用自定义字体，同时支持 Dynamic Type：

#### SwiftUI

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        Text("自定义字体")
            // 使用自定义字体，但相对于 body 样式缩放
            .font(.custom("Avenir-Heavy", size: 17, relativeTo: .body))
    }
}
```

#### UIKit

```swift
import UIKit

class ViewController: UIViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        let label = UILabel()
        label.adjustsFontForContentSizeCategory = true
        
        // 使用 UIFontMetrics 缩放自定义字体
        let customFont = UIFont(name: "Avenir-Heavy", size: 17)!
        label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: customFont)
        
        label.numberOfLines = 0
        label.text = "自定义字体"
        
        view.addSubview(label)
    }
}
```

---

## 动态布局适配

### 问题场景

当文本大小增加时，原本水平排列的元素可能会：
- 文本被截断
- 内容溢出容器
- 布局变得拥挤难以阅读

### 解决方案：响应式布局切换

根据文本大小动态切换布局方向：
- **标准大小**：水平布局 (HStack)
- **辅助功能大小**：垂直布局 (VStack)

### SwiftUI 实现

#### 单个单元格的动态布局

```swift
import SwiftUI

struct FigureCell: View {
    // 1. 获取当前 Dynamic Type 大小
    @Environment(\.dynamicTypeSize) 
    private var dynamicTypeSize: DynamicTypeSize
    
    // 2. 根据大小决定布局方向
    var dynamicLayout: AnyLayout { 
        dynamicTypeSize.isAccessibilitySize ?
            AnyLayout(HStackLayout()) :      // 辅助功能大小：图标和文字水平排列
            AnyLayout(VStackLayout())        // 标准大小：图标在上，文字在下
    }
    
    let systemImageName: String
    let imageTitle: String
    
    var body: some View {
        // 3. 使用动态布局
        dynamicLayout {
            Image(systemName: systemImageName)
                .font(.largeTitle)
                .foregroundStyle(.blue)
            
            Text(imageTitle)
                .font(.caption)
        }
    }
}
```

#### 容器视图的动态布局

```swift
import SwiftUI

struct FigureContentView: View {
    @Environment(\.dynamicTypeSize) 
    private var dynamicTypeSize: DynamicTypeSize
    
    // 容器布局：辅助功能大小时垂直排列，否则水平排列
    var dynamicLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize ?
            AnyLayout(VStackLayout(alignment: .leading)) :
            AnyLayout(HStackLayout(alignment: .top))
    }
    
    var body: some View {
        dynamicLayout {
            FigureCell(systemImageName: "figure.stand", imageTitle: "站立")
            FigureCell(systemImageName: "figure.wave", imageTitle: "挥手")
            FigureCell(systemImageName: "figure.walk", imageTitle: "行走")
            FigureCell(systemImageName: "figure.roll", imageTitle: "滚动")
        }
        .padding()
    }
}
```

### UIKit 实现

```swift
import UIKit

class FigureViewController: UIViewController {
    
    private var mainStackView: UIStackView!
    
    // MARK: - Lifecycle
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        
        // 1. 订阅文本大小变化通知
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textSizeDidChange(_:)),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupStackView()
        updateLayoutForCurrentTextSize()
    }
    
    // MARK: - Setup
    
    private func setupStackView() {
        mainStackView = UIStackView()
        mainStackView.distribution = .fillEqually
        mainStackView.spacing = 16
        
        // 添加子视图...
        
        view.addSubview(mainStackView)
        // 设置约束...
    }
    
    // MARK: - Dynamic Type Response
    
    @objc private func textSizeDidChange(_ notification: Notification?) {
        updateLayoutForCurrentTextSize()
    }
    
    private func updateLayoutForCurrentTextSize() {
        // 2. 检查是否为辅助功能大小
        let isAccessibilityCategory = traitCollection
            .preferredContentSizeCategory
            .isAccessibilityCategory
        
        // 3. 根据大小切换布局轴向
        mainStackView.axis = isAccessibilityCategory ? .vertical : .horizontal
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
```

### ViewThatFits（iOS 16+）

SwiftUI 提供了更简洁的自适应布局方案：

```swift
import SwiftUI

struct AdaptiveStack<Content: View>: View {
    let content: Content
    
    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }
    
    var body: some View {
        // ViewThatFits 会自动选择第一个能够适应可用空间的布局
        ViewThatFits {
            HStack { content }  // 优先尝试水平布局
            VStack { content }  // 如果水平不行，使用垂直布局
        }
    }
}

// 使用示例
struct ContentView: View {
    var body: some View {
        AdaptiveStack {
            Text("标签一")
            Text("标签二")
            Text("标签三")
        }
    }
}
```

---

## 图片与符号的处理

### 处理原则

在使用 Dynamic Type 时，需要平衡图片/图标的缩放与文本空间的分配：

| 图片类型 | 建议处理方式 |
|---------|------------|
| **装饰性图片** | 保持固定大小，让文本环绕 |
| **功能性图标** | 随文本缩放 |
| **SF Symbols** | 自动缩放（推荐） |
| **包含文字的图片** | 必须缩放 |

### SF Symbols（推荐）

SF Symbols 会自动随 Dynamic Type 缩放：

#### SwiftUI

```swift
import SwiftUI

struct SymbolView: View {
    var body: some View {
        Label("收藏", systemImage: "heart.fill")
            .font(.body)  // Symbol 会随 body 样式缩放
    }
}
```

#### UIKit

```swift
import UIKit

func createScaledSymbol() -> UIImage? {
    // 创建与 body 样式关联的符号配置
    let configuration = UIImage.SymbolConfiguration(textStyle: .body)
    return UIImage(systemName: "heart.fill", withConfiguration: configuration)
}
```

### 内联图片（文本中的图片）

#### SwiftUI - 在 List 中自动处理

```swift
import SwiftUI

struct ArticleListView: View {
    var body: some View {
        List {
            // List 会自动处理图片和文本的布局
            Label("站立姿势", systemImage: "figure.stand")
            Label("行走姿势", systemImage: "figure.walk")
            Label("滚动姿势", systemImage: "figure.roll")
        }
    }
}
```

#### SwiftUI - 文本插值

```swift
import SwiftUI

struct InlineImageView: View {
    var body: some View {
        // 将图片直接插入文本中
        Text("点击 \(Image(systemName: "heart.fill")) 收藏")
            .font(.body)
    }
}
```

#### UIKit - NSAttributedString

```swift
import UIKit

func createAttributedStringWithImage(
    systemImageName: String,
    title: String
) -> NSAttributedString {
    
    // 1. 创建图片附件
    let attachment = NSTextAttachment()
    attachment.image = UIImage(systemName: systemImageName)
    
    // 2. 创建可变属性字符串
    let attributedString = NSMutableAttributedString(attachment: attachment)
    
    // 3. 添加空格和标题
    attributedString.append(NSAttributedString(string: " \(title)"))
    
    return attributedString
}

// 使用
let label = UILabel()
label.attributedText = createAttributedStringWithImage(
    systemImageName: "figure.stand",
    title: "站立姿势"
)
```

### 自定义图片缩放

#### SwiftUI - @ScaledMetric

```swift
import SwiftUI

struct ScaledImageView: View {
    // 使用 @ScaledMetric 让尺寸随 Dynamic Type 缩放
    @ScaledMetric(relativeTo: .body) var imageWidth: CGFloat = 125
    @ScaledMetric(relativeTo: .body) var imageHeight: CGFloat = 125
    
    var body: some View {
        VStack {
            Image("CustomImage")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageWidth, height: imageHeight)
            
            Text("图片说明")
                .font(.caption)
        }
    }
}
```

#### UIKit - UIFontMetrics

```swift
import UIKit

class ScaledImageViewController: UIViewController {
    
    private let imageView = UIImageView()
    private let baseImageSize: CGFloat = 125
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        imageView.image = UIImage(named: "CustomImage")
        imageView.contentMode = .scaleAspectFit
        
        updateImageSize()
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(updateImageSize),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )
    }
    
    @objc private func updateImageSize() {
        // 使用 UIFontMetrics 缩放图片尺寸
        let scaledSize = UIFontMetrics(forTextStyle: .body)
            .scaledValue(for: baseImageSize)
        
        // 更新图片视图约束
        imageView.widthAnchor.constraint(equalToConstant: scaledSize).isActive = true
        imageView.heightAnchor.constraint(equalToConstant: scaledSize).isActive = true
    }
}
```

---

## 大内容查看器 (Large Content Viewer)

### 什么是大内容查看器？

大内容查看器是一种辅助功能，用于那些**无法随 Dynamic Type 缩放**的 UI 元素（如标签栏、工具栏）。

当用户长按这些元素时，会在屏幕中央显示放大的标签和图标。

### 工作原理

1. 用户启用辅助功能文本大小
2. 长按无法缩放的控件（如标签栏项）
3. 屏幕中央显示放大的图标和文字
4. 滑动可切换到其他项目
5. 抬起手指导航到该项目

### 系统控件支持

以下系统控件**自动支持**大内容查看器：

- `UITabBar`
- `UIToolbar`
- `UINavigationBar`
- 标准系统按钮

> ✅ 如果使用系统控件，无需额外代码！

### 自定义控件支持

#### SwiftUI 实现

```swift
import SwiftUI

struct CustomTabBar: View {
    @Binding var selectedTab: Tab
    
    enum Tab: String, CaseIterable {
        case home = "首页"
        case search = "搜索"
        case favorites = "收藏"
        case profile = "我的"
        
        var systemImage: String {
            switch self {
            case .home: return "house.fill"
            case .search: return "magnifyingglass"
            case .favorites: return "heart.fill"
            case .profile: return "person.fill"
            }
        }
    }
    
    var body: some View {
        HStack {
            ForEach(Tab.allCases, id: \.self) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.systemImage)
                            .font(.title2)
                        Text(tab.rawValue)
                            .font(.caption2)
                    }
                    .foregroundStyle(selectedTab == tab ? .blue : .gray)
                }
                .frame(maxWidth: .infinity)
                // ✅ 添加大内容查看器支持
                .accessibilityShowsLargeContentViewer {
                    Label(tab.rawValue, systemImage: tab.systemImage)
                }
            }
        }
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}
```

#### UIKit 实现

```swift
import UIKit

class CustomTabBarCell: UIStackView, UILargeContentViewerItem {
    
    // MARK: - Properties
    
    var systemImageName: String
    var imageTitle: String
    
    // MARK: - UILargeContentViewerItem
    
    var showsLargeContentViewer: Bool = true
    
    var largeContentTitle: String? {
        return imageTitle
    }
    
    var largeContentImage: UIImage? {
        return UIImage(systemName: systemImageName)
    }
    
    var scalesLargeContentImage: Bool = true
    
    // MARK: - Initialization
    
    init(systemImageName: String, imageTitle: String) {
        self.systemImageName = systemImageName
        self.imageTitle = imageTitle
        
        super.init(frame: .zero)
        
        setupViews()
        
        // ✅ 添加大内容查看器交互
        addInteraction(UILargeContentViewerInteraction())
    }
    
    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupViews() {
        axis = .vertical
        alignment = .center
        spacing = 4
        
        let imageView = UIImageView(image: UIImage(systemName: systemImageName))
        imageView.contentMode = .scaleAspectFit
        
        let label = UILabel()
        label.text = imageTitle
        label.font = .preferredFont(forTextStyle: .caption2)
        
        addArrangedSubview(imageView)
        addArrangedSubview(label)
    }
}
```

### 处理自定义手势

如果自定义控件有自己的手势识别器，需要设置手势关系：

```swift
import UIKit

class CustomControlWithGestures: UIView {
    
    private var largeContentInteraction: UILargeContentViewerInteraction!
    private var tapGesture: UITapGestureRecognizer!
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        
        // 1. 创建大内容查看器交互
        largeContentInteraction = UILargeContentViewerInteraction()
        addInteraction(largeContentInteraction)
        
        // 2. 创建自定义手势
        tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        addGestureRecognizer(tapGesture)
        
        // 3. 设置手势关系，让大内容查看器优先处理
        if let lcvGesture = largeContentInteraction.gestureRecognizerForExclusionRelationship {
            tapGesture.require(toFail: lcvGesture)
        }
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    @objc private func handleTap() {
        // 处理点击
    }
}
```

---

## 测试与调试

### Xcode Previews

#### 查看所有 Dynamic Type 变体

1. 打开 SwiftUI 视图文件
2. 在 Canvas 中点击 **Variants** 按钮
3. 选择 **Dynamic Type Variants**
4. Xcode 会生成所有文本大小的预览

```swift
import SwiftUI

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            // 手动指定特定大小预览
            .environment(\.dynamicTypeSize, .accessibility3)
    }
}
```

#### 指定特定文本大小

在 Canvas 设置中选择特定的文本大小进行预览。

### Xcode 调试器

在运行时覆盖 Dynamic Type 设置：

1. 运行应用
2. 点击调试工具栏中的 **Environment Overrides** 按钮
3. 启用 **Dynamic Type**
4. 调整滑块选择不同大小

### 辅助功能审计

Xcode 可以自动检测 Dynamic Type 相关问题：

```swift
import XCTest

class AccessibilityAuditTests: XCTestCase {
    
    func testAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        
        // 执行辅助功能审计
        try app.performAccessibilityAudit()
    }
    
    func testAccessibilityAuditForDynamicType() throws {
        let app = XCUIApplication()
        app.launch()
        
        // 针对特定类别进行审计
        try app.performAccessibilityAudit(for: [.dynamicType])
    }
}
```

### 常见问题检测

审计会检测以下问题：

| 问题类型 | 说明 |
|---------|-----|
| **文本截断** | 文本无法完整显示 |
| **文本裁剪** | 文本被容器边界裁剪 |
| **固定字体** | 使用了不支持 Dynamic Type 的固定字体 |
| **布局问题** | 元素重叠或溢出 |

### 模拟器测试

在模拟器中测试不同文本大小：

```
设置 → 辅助功能 → 显示与文字大小 → 更大字体
```

---

## 最佳实践清单

### ✅ 必须做

- [ ] 使用系统文本样式（`.body`, `.title` 等）
- [ ] UIKit 中设置 `adjustsFontForContentSizeCategory = true`
- [ ] 设置 `numberOfLines = 0` 允许多行
- [ ] 测试所有 12 种文本大小
- [ ] 为辅助功能大小提供响应式布局
- [ ] 为无法缩放的控件实现大内容查看器

### ✅ 推荐做

- [ ] 使用 SF Symbols（自动缩放）
- [ ] 使用 `@ScaledMetric` 缩放自定义尺寸
- [ ] 使用 `ViewThatFits` 实现自适应布局
- [ ] 将辅助功能审计集成到 CI/CD
- [ ] 在真机上测试（特别是较小的设备）

### ❌ 避免做

- [ ] 使用固定字体大小
- [ ] 使用固定高度的容器
- [ ] 忽略辅助功能文本大小
- [ ] 在大文本时移除重要功能
- [ ] 假设文本只需要一行

### 代码审查检查点

```swift
// ❌ 错误示例
Text("标题")
    .font(.system(size: 17))  // 固定大小，不会响应 Dynamic Type

label.font = UIFont.systemFont(ofSize: 17)  // 固定大小

// ✅ 正确示例
Text("标题")
    .font(.body)  // 使用系统样式

label.font = .preferredFont(forTextStyle: .body)  // 使用系统样式
label.adjustsFontForContentSizeCategory = true
```

---

## 相关资源

### 官方文档

- [Human Interface Guidelines: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Human Interface Guidelines: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Enhancing the accessibility of your SwiftUI app](https://developer.apple.com/documentation/Accessibility/enhancing-the-accessibility-of-your-swiftui-app)

### API 参考

- [SwiftUI Font](https://developer.apple.com/documentation/swiftui/font)
- [UIFont.preferredFont(forTextStyle:)](https://developer.apple.com/documentation/uikit/uifont/1619030-preferredfont)
- [DynamicTypeSize](https://developer.apple.com/documentation/swiftui/dynamictypesize)
- [UILargeContentViewerInteraction](https://developer.apple.com/documentation/UIKit/UILargeContentViewerInteraction)
- [accessibilityShowsLargeContentViewer()](https://developer.apple.com/documentation/SwiftUI/View/accessibilityShowsLargeContentViewer())

### WWDC 视频

- [WWDC 2024: Get started with Dynamic Type](https://developer.apple.com/videos/play/wwdc2024/10074/)
- [WWDC 2024: Catch up on accessibility in SwiftUI](https://developer.apple.com/videos/play/wwdc2024/10073/)

### 开发者论坛

- [Accessibility & Inclusion Forum](https://developer.apple.com/forums/topics/accessibility-and-inclusion)

---

## 附录：完整代码示例

### 响应式卡片组件

```swift
import SwiftUI

struct ResponsiveCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    
    let title: String
    let description: String
    let iconName: String
    
    private var isAccessibilitySize: Bool {
        dynamicTypeSize.isAccessibilitySize
    }
    
    var body: some View {
        Group {
            if isAccessibilitySize {
                // 辅助功能大小：垂直布局
                VStack(alignment: .leading, spacing: 12) {
                    iconView
                    textContent
                }
            } else {
                // 标准大小：水平布局
                HStack(alignment: .top, spacing: 16) {
                    iconView
                    textContent
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
    
    private var iconView: some View {
        Image(systemName: iconName)
            .font(.title)
            .foregroundStyle(.blue)
            .frame(width: 44, height: 44)
            .background(Color.blue.opacity(0.1))
            .cornerRadius(8)
    }
    
    private var textContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(description)
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }
}

// 预览
struct ResponsiveCard_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ResponsiveCard(
                title: "动态字体",
                description: "支持所有文本大小，提供最佳阅读体验。",
                iconName: "textformat.size"
            )
            .previewDisplayName("Default")
            
            ResponsiveCard(
                title: "动态字体",
                description: "支持所有文本大小，提供最佳阅读体验。",
                iconName: "textformat.size"
            )
            .environment(\.dynamicTypeSize, .accessibility3)
            .previewDisplayName("Accessibility 3")
        }
        .padding()
        .previewLayout(.sizeThatFits)
    }
}
```

---

> 📝 **文档版本**: 1.0  
> 📅 **最后更新**: 2024年12月  
> 🎬 **基于**: WWDC 2024 Session 10074

