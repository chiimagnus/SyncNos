# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
SyncNos is a macOS application that synchronizes highlights and notes from Apple Books and GoodLinks to Notion. The app is built with SwiftUI for macOS 13+ using Swift 5.0+.

## Architecture
The application follows a clean architecture pattern with dependency injection using a DIContainer. Key architectural elements:
- **Dependency Injection**: Uses DIContainer.swift for managing service dependencies
- **Services Layer**: Organized in numbered directories (0-NotionAPI, 1-AppleBooks, 2-GoodLinks, Infrastructure, IAP)
- **Models**: Core data models defined in Models.swift
- **ViewModels**: Follow MVVM pattern with specific view models for each feature
- **Views**: SwiftUI views organized in Components, AppleBooks, GoodLinks, and Settings directories

## Key Services
- `AppleBooksSyncService`: Handles Apple Books data synchronization
- `GoodLinksDatabaseService`: Handles GoodLinks app integration
- `NotionService`: Manages Notion API interactions
- `AutoSyncService`: Provides automatic synchronization functionality
- `IAPService`: Handles in-app purchases
- `LoggerService`: Provides logging functionality

## Data Models
- `BookListItem`: Lightweight model for book listings
- `Highlight`: Represents individual highlights with text, notes, and metadata
- `HighlightRow` and `BookRow`: UI-specific data representations
- `ContentSource`: Enum for data source selection (Apple Books, GoodLinks)

## Development Commands
- **Build**: `xcodebuild -scheme SyncNos -configuration Debug`
- **Build Release**: `xcodebuild -scheme SyncNos -configuration Release`
- **Clean**: `xcodebuild clean -scheme SyncNos`
- **Test**: Standard Xcode testing via `xcodebuild test` (if tests exist)
- **Run**: Use Xcode IDE or `xcodebuild build` then run the resulting app

## Build Environment
- macOS 13+ required
- Xcode 14+ recommended
- Swift 5.0+ compatible
- Project scheme: "SyncNos"
- Build configurations: Debug, Release

## Project Structure
```
SyncNos/
├── Models/                 # Data models
├── Services/               # Business logic services
│   ├── 0-NotionAPI/        # Notion integration
│   ├── 1-AppleBooks/       # Apple Books integration
│   ├── 2-GoodLinks/        # GoodLinks integration
│   ├── Infrastructure/     # Core infrastructure
│   └── IAP/                # In-app purchase
├── ViewModels/             # View model layer
├── Views/                  # SwiftUI views
│   ├── AppleBooks/         # Apple Books UI
│   ├── GoodLinks/          # GoodLinks UI
│   ├── Components/         # Reusable components
│   └── Setting/            # Settings UI
├── Assets.xcassets/        # Asset catalog
├── SyncNosApp.swift        # App entry point
└── MainListView.swift      # Main application view
```

## Key Implementation Notes
- Uses bookmark APIs for persistent file access permissions
- Implements auto-sync functionality with UserDefaults management
- Follows Apple's data access guidelines for protected containers
- Includes in-app purchase support
- Uses UserDefaults for configuration persistence
- Implements proper error handling throughout services

# 最佳实践指南：SwiftUI响应式布局 + MVVM架构 + Combine响应式编程

## 项目架构要求

### 核心技术栈
- **架构模式**: MVVM (Model-View-ViewModel)
- **UI框架**: SwiftUI (iOS17+, iPadOS17+, macOS13+)
- **响应式编程**: Combine
- **数据持久化**: SwiftData
- **语言版本**: Swift 6.1+、Swift5+

### 平台支持
- iOS 17.0+
- iPadOS 17.0+
- macOS 13.0+

## MVVM架构规范

### 1. Models (数据模型)
- 纯数据结构，不包含业务逻辑
- 使用 `@Model` 宏用于 SwiftData
- 只包含属性和简单的数据处理方法
- 不直接引用 SwiftUI 或 Combine
- 数据结构应该清晰、简洁

### 2. ViewModels (视图模型)
- 处理业务逻辑，管理状态
- 二选一：使用 `ObservableObject` + `@Published`，或使用 `@Observable`；不要混用
- 使用 `ObservableObject` 时使用 `@Published`；使用 `@Observable` 时不要使用 `@Published`
- 不直接引用 SwiftUI Views
- **禁止使用单例模式** (`shared` 静态实例)
- 使用 Combine 进行响应式数据流处理（需 `$property`/`assign(to:)` 时，选择 `ObservableObject` + `@Published`）
- 状态管理与UI逻辑，处理用户交互
- 数据绑定，向View提供格式化数据
- 调用Service执行业务操作，订阅数据变化（Combine）
- 错误与加载状态统一处理

#### ViewModel响应式编程规范
- 使用 `ObservableObject` 时：用 `@Published` 标记需要触发 UI 的属性
- 使用 `@Observable` 时：不要使用 `@Published`，直接声明属性；双向绑定用 `@Bindable`
- **计算属性响应式**: 计算属性应自动响应上游可观察属性变化
- Combine 订阅（仅 `ObservableObject`）：使用 `$property.sink` 或 `assign(to:)` 等
- **避免手动通知**: 不要手动调用`objectWillChange.send()`，依赖`@Published`自动机制
- 使用 Combine 操作符 (map, filter, debounce, etc.) 处理复杂数据流
- 使用 `Set<AnyCancellable>` 管理订阅生命周期

### 3. Views (视图)
- 纯UI展示，不包含业务逻辑
- 绑定策略：`ObservableObject` 用 `@StateObject/@ObservedObject`；`@Observable` 用 `@State`/`@Environment` + `@Bindable`（不要混用）
- 组件化、可复用、条件渲染（加载/错误/空数据）
- iOS设备适配（iPhone/iPad）、暗黑模式、主题切换
- 响应式布局，支持不同屏幕尺寸

## 代码组织与职责分离

### 文件结构
```
Feature/
├── Views/
│   ├── FeatureView.swift
│   └── Components/
├── ViewModels/
│   └── FeatureViewModel.swift
├── Models/
│   └── FeatureModel.swift
└── Services/
    └── FeatureService.swift
```

### 职责分离原则
- **Views**: 只负责UI展示和用户交互响应
- **ViewModels**: 处理业务逻辑、数据转换、状态管理
- **Models**: 数据结构定义和简单数据处理
- **Services**: 网络请求、数据存储等基础设施逻辑

## ViewModel 实例化策略

### 推荐方式
1. **按需创建**：每个视图创建独立的ViewModel实例
2. **依赖注入**：通过 `.environmentObject()`（ObservableObject）或 `.environment(...)`（@Observable）传递 ViewModel
3. **生命周期管理**：
   - 短期：使用 `@State` 管理
   - 长期：使用 `@Environment` 或 `@StateObject`

### 禁止方式
- ❌ 使用 `static let shared` 单例模式
- ❌ 在ViewModel中创建全局状态
- ❌ 多个视图共享同一个ViewModel实例

### 正确示例
```swift
// ✅ 正确：按需创建（ObservableObject）
@StateObject private var viewModel = ItemViewModel()

// ✅ 正确：依赖注入（ObservableObject）
.environmentObject(viewModel)

// ✅ 正确：响应式ViewModel（ObservableObject + Combine）
class ItemViewModel: ObservableObject {
    @Published var items: [Item] = []
    @Published var filteredItems: [DisplayItem] = []
    @Published var isLoading = false

    private var cancellables = Set<AnyCancellable>()

    init() {
        $items
            .map { items in
                items.map { DisplayItem(from: $0) }
            }
            .assign(to: &$filteredItems)
    }
}
```

## SwiftUI最佳实践

### 响应式布局
- 优先使用 SwiftUI 内置的响应式布局系统
- 合理使用 Size Classes 进行设备适配
- 避免过度使用 GeometryReader
- 使用 ScrollView 优化长内容展示

### 状态管理
```swift
// ✅ 正确：按需创建ViewModel（ObservableObject）
struct FeatureView: View {
    @StateObject private var viewModel = FeatureViewModel()

    var body: some View {
        ContentView()
            .environmentObject(viewModel)
    }
}

// ✅ 正确：响应式ViewModel（ObservableObject + Combine）
class FeatureViewModel: ObservableObject {
    @Published var items: [Item] = []
    @Published var isLoading = false

    private var cancellables = Set<AnyCancellable>()

    init() {
        $items
            .map { items in
                items.map { transformItem($0) }
            }
            .sink { [weak self] transformedItems in
                // 处理转换后的数据
            }
            .store(in: &cancellables)
    }
}
```

### 组件化开发
- 每个组件职责单一
- 组件可复用、可测试
- 合理使用 ViewModifier 和 ViewBuilder
- 避免过深层次的视图嵌套

## Combine响应式编程

### 数据流处理
```swift
// ViewModel中的响应式数据处理
class MyViewModel: ObservableObject {
    @Published var sourceData: [DataModel] = []
    @Published var processedData: [DisplayModel] = []
    @Published var searchText = ""
    @Published var searchResults: [Item] = []
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        // 响应式数据转换
        $sourceData
            .map { data in
                // 业务逻辑处理
                return data.map { DisplayModel(from: $0) }
            }
            .assign(to: &$processedData)
            
        // 搜索功能
        $searchText
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .removeDuplicates()
            .flatMap { text in
                text.isEmpty ? Just([]).eraseToAnyPublisher() : 
                self.searchService.search(text).catch { _ in Just([]) }.eraseToAnyPublisher()
            }
            .assign(to: &$searchResults)
    }
}

### 响应式编程最佳实践
1. **数据源响应**: 使用`@Published`属性作为数据源
2. **自动转换**: 通过`.map`、`.filter`等操作符处理数据
3. **链式操作**: 使用`.assign(to:)`或`.sink`订阅结果
4. **内存管理**: 使用`Set<AnyCancellable>`管理订阅生命周期
5. **错误处理**: 使用`.catch`、`.replaceError`处理错误情况
```

### 错误处理
- 使用 `catch` 操作符处理错误
- 统一错误处理机制
- 避免在 View 层处理复杂错误逻辑

## 禁止事项

### 架构层面
- ❌ 在 View 中直接处理业务逻辑
- ❌ 在 Model 中包含业务逻辑
- ❌ 使用单例模式创建 ViewModel
- ❌ 多个 View 共享同一个 ViewModel 实例
- ❌ 在 ViewModel 中直接操作 UI
- ❌ 在View中直接访问数据库

### 代码实现
- ❌ 手动计算屏幕尺寸和比例
- ❌ 使用固定像素值布局
- ❌ 复杂的 GeometryReader 嵌套
- ❌ 忽略内存管理 (忘记调用 store(in:))

## 性能优化

### 响应式数据流
- 合理使用 `@Published` 避免不必要的更新
- 使用 `removeDuplicates()` 减少重复计算
- 使用 `debounce()` 优化用户输入响应

### 视图渲染
- 避免在 `body` 中进行复杂计算
- 使用 `@State` 和 `@Binding` 优化状态传递
- 合理使用 `@ViewBuilder` 优化视图构建
