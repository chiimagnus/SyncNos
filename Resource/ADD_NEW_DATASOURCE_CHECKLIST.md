# 添加新数据源完整指南 (Add New DataSource Checklist)

本文档详细描述了如何在 SyncNos 中添加新的数据源（例如：得到、Logseq、Readwise 等）。

---

## 目录

1. [概述](#概述)
2. [前置准备](#前置准备)
3. [第一阶段：数据模型](#第一阶段数据模型)
4. [第二阶段：数据读取服务](#第二阶段数据读取服务)
5. [第三阶段：同步适配器](#第三阶段同步适配器)
6. [第四阶段：ViewModel](#第四阶段viewmodel)
7. [第五阶段：Views](#第五阶段views)
8. [第六阶段：自动同步](#第六阶段自动同步)
9. [第七阶段：配置与注册](#第七阶段配置与注册)
10. [第八阶段：国际化](#第八阶段国际化)
11. [第九阶段：测试与验证](#第九阶段测试与验证)
12. [完整文件清单](#完整文件清单)

---

## 概述

### 架构模式

```
┌─────────────────────────────────────────────────────────────────┐
│                           Views                                  │
│         (XxxListView, XxxDetailView, XxxSettingsView)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ViewModels                                │
│              (XxxViewModel, XxxSettingsViewModel)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NotionSyncEngine                              │
│       (统一同步引擎，处理所有数据源到 Notion 的同步)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                NotionSyncSourceProtocol                          │
│                    (数据源适配器)                                 │
│         XxxNotionAdapter - 将数据源转换为 UnifiedHighlight       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DataSource Service                            │
│         (XxxAPIService / XxxDatabaseService - 读取原始数据)      │
└─────────────────────────────────────────────────────────────────┘
```

### 命名约定

假设新数据源名为 `Xxx`（如 `Dedao`、`Logseq`、`Readwise`）：

| 类型 | 命名模式 | 示例 |
|------|----------|------|
| 数据模型 | `XxxModels.swift` | `DedaoModels.swift` |
| 缓存模型 | `XxxCacheModels.swift` | `DedaoCacheModels.swift` |
| API 服务 | `XxxAPIService.swift` | `DedaoAPIService.swift` |
| 认证服务 | `XxxAuthService.swift` | `DedaoAuthService.swift` |
| 适配器 | `XxxNotionAdapter.swift` | `DedaoNotionAdapter.swift` |
| ViewModel | `XxxViewModel.swift` | `DedaoViewModel.swift` |
| DetailViewModel | `XxxDetailViewModel.swift` | `DedaoDetailViewModel.swift` |
| ListView | `XxxListView.swift` | `DedaoListView.swift` |
| DetailView | `XxxDetailView.swift` | `DedaoDetailView.swift` |
| SettingsView | `XxxSettingsView.swift` | `DedaoSettingsView.swift` |
| AutoSyncProvider | `XxxAutoSyncProvider.swift` | `DedaoAutoSyncProvider.swift` |
| SyncService | `XxxSyncService.swift`（可选） | `DedaoSyncService.swift` |

---

## 前置准备

### Checklist

- [ ] 确定数据源类型（本地数据库 / Web API / 文件系统）
- [ ] 研究数据源的数据结构（书籍/文章、高亮、笔记）
- [ ] 确定认证方式（Cookie / OAuth / API Key / 无需认证）
- [ ] 确定同步策略（仅支持 SingleDB / 支持 PerBook）

---

## 第一阶段：数据模型

### 1.1 添加数据源枚举值

#### 文件：`SyncNos/Models/SyncQueueModels.swift`

```swift
enum SyncSource: String, Codable, CaseIterable, Sendable {
    case appleBooks
    case goodLinks
    case weRead
    case xxx        // ← 添加新数据源
}
```

#### 文件：`SyncNos/Models/Models.swift`

```swift
enum ContentSource: String, Codable, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"
    case weRead = "weRead"
    case xxx = "xxx"    // ← 添加新数据源

    var title: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        case .xxx: return "Xxx"    // ← 添加显示名称
        }
    }
}
```

#### 文件：`SyncNos/Models/HighlightColorScheme.swift`

```swift
enum HighlightSource: String {
    case appleBooks
    case goodLinks
    case weRead
    case xxx        // ← 添加新数据源
}

enum HighlightColorScheme {
    static func allDefinitions(for source: HighlightSource) -> [HighlightColorDefinition] {
        switch source {
        // ... 现有 case ...
        case .xxx:
            return [
                // ← 添加该数据源的颜色映射
                HighlightColorDefinition(index: 0, notionName: "yellow", displayName: "Yellow"),
                HighlightColorDefinition(index: 1, notionName: "green", displayName: "Green"),
                // ...
            ]
        }
    }
}
```

### 1.2 创建数据模型文件

#### 文件：`SyncNos/Models/XxxModels.swift`（新建）

```swift
import Foundation

// MARK: - Book/Article List Item

/// 用于列表展示的书籍/文章模型
struct XxxBookListItem: Identifiable, Equatable, Codable {
    var id: String { bookId }
    
    let bookId: String
    let title: String
    let author: String
    let coverURL: String?
    let highlightCount: Int
    let lastReadTime: Date?
    
    // 根据数据源 API 添加其他必要字段
}

// MARK: - API Response Models (如果是 Web API)

/// API 响应模型
struct XxxAPIResponse<T: Codable>: Codable {
    let code: Int
    let data: T?
    let message: String?
}

/// 书籍列表响应
struct XxxNotebookResponse: Codable {
    let books: [XxxNotebook]
}

struct XxxNotebook: Codable {
    let bookId: String
    let title: String
    let author: String
    // ...
}

/// 高亮/书签数据
struct XxxBookmark: Codable {
    let highlightId: String
    let bookId: String
    let text: String
    let note: String?
    let colorIndex: Int?
    let chapterTitle: String?
    let timestamp: TimeInterval?
}
```

### 1.3 添加 UnifiedHighlight 转换（如需要）

#### 文件：`SyncNos/Models/UnifiedHighlight.swift`

```swift
// 在 UnifiedHighlight 中添加转换初始化器
extension UnifiedHighlight {
    /// 从 XxxBookmark 转换
    init(from bookmark: XxxBookmark) {
        self.uuid = bookmark.highlightId
        self.text = bookmark.text
        self.note = bookmark.note
        self.colorIndex = bookmark.colorIndex
        self.dateAdded = bookmark.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.dateModified = nil
        self.location = bookmark.chapterTitle
        self.source = .xxx
    }
}
```

### 1.4 添加 UnifiedSyncItem 转换

#### 文件：`SyncNos/Models/UnifiedHighlight.swift`

```swift
// 在 UnifiedSyncItem 中添加转换初始化器
extension UnifiedSyncItem {
    /// 从 XxxBookListItem 转换
    init(from item: XxxBookListItem) {
        self.id = item.bookId
        self.title = item.title
        self.author = item.author
        self.coverURL = item.coverURL
        self.highlightCount = item.highlightCount
        self.source = .xxx
    }
}
```

### 1.5 创建缓存模型（如需要本地缓存）

#### 文件：`SyncNos/Models/XxxCacheModels.swift`（新建）

```swift
import Foundation
import SwiftData

// MARK: - Cached Book

@Model
final class CachedXxxBook {
    @Attribute(.unique) var bookId: String
    var title: String
    var author: String
    var coverURL: String?
    var highlightCount: Int
    var lastSyncAt: Date?
    
    init(bookId: String, title: String, author: String, coverURL: String?, highlightCount: Int) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.coverURL = coverURL
        self.highlightCount = highlightCount
    }
}

// MARK: - Cached Highlight

@Model
final class CachedXxxHighlight {
    @Attribute(.unique) var highlightId: String
    var bookId: String
    var text: String
    var note: String?
    var colorIndex: Int?
    var chapterTitle: String?
    var timestamp: Date?
    
    init(from bookmark: XxxBookmark) {
        self.highlightId = bookmark.highlightId
        self.bookId = bookmark.bookId
        self.text = bookmark.text
        self.note = bookmark.note
        self.colorIndex = bookmark.colorIndex
        self.chapterTitle = bookmark.chapterTitle
        self.timestamp = bookmark.timestamp.map { Date(timeIntervalSince1970: $0) }
    }
}

// MARK: - Sync State

@Model
final class XxxSyncState {
    @Attribute(.unique) var key: String
    var syncKey: String?
    var lastSyncAt: Date?
    
    init(key: String = "default") {
        self.key = key
    }
}
```

### Checklist

- [ ] 在 `SyncSource` 枚举中添加新数据源
- [ ] 在 `ContentSource` 枚举中添加新数据源和显示名称
- [ ] 在 `HighlightSource` 枚举中添加新数据源
- [ ] 在 `HighlightColorScheme` 中添加颜色映射
- [ ] 创建 `XxxModels.swift` 定义数据模型
- [ ] 在 `UnifiedHighlight` 中添加转换初始化器
- [ ] 在 `UnifiedSyncItem` 中添加转换初始化器
- [ ] （可选）创建 `XxxCacheModels.swift` 定义 SwiftData 缓存模型

---

## 第二阶段：数据读取服务

### 2.1 创建服务目录

```bash
mkdir -p SyncNos/Services/DataSources-From/Xxx
```

### 2.2 创建认证服务（如需要）

#### 文件：`SyncNos/Services/DataSources-From/Xxx/XxxAuthService.swift`（新建）

```swift
import Foundation

// MARK: - Protocol

protocol XxxAuthServiceProtocol: AnyObject {
    var isLoggedIn: Bool { get }
    func getCookieHeader() -> String?
    func saveCookieHeader(_ header: String)
    func clearCredentials()
}

// MARK: - Implementation

final class XxxAuthService: XxxAuthServiceProtocol {
    
    private let keychainKey = "xxx.cookie"
    
    var isLoggedIn: Bool {
        getCookieHeader() != nil
    }
    
    func getCookieHeader() -> String? {
        KeychainHelper.load(key: keychainKey)
    }
    
    func saveCookieHeader(_ header: String) {
        KeychainHelper.save(key: keychainKey, value: header)
    }
    
    func clearCredentials() {
        KeychainHelper.delete(key: keychainKey)
    }
}
```

### 2.3 创建 API 服务（Web API 数据源）

#### 文件：`SyncNos/Services/DataSources-From/Xxx/XxxAPIService.swift`（新建）

```swift
import Foundation

// MARK: - Protocol

protocol XxxAPIServiceProtocol: AnyObject {
    func fetchNotebooks() async throws -> [XxxNotebook]
    func fetchHighlights(bookId: String) async throws -> [XxxBookmark]
}

// MARK: - Implementation

final class XxxAPIService: XxxAPIServiceProtocol {
    
    private let authService: XxxAuthServiceProtocol
    private let logger: LoggerServiceProtocol
    private let baseURL = "https://api.xxx.com"
    
    init(
        authService: XxxAuthServiceProtocol,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.logger = logger
    }
    
    func fetchNotebooks() async throws -> [XxxNotebook] {
        guard let cookie = authService.getCookieHeader() else {
            throw XxxError.notLoggedIn
        }
        
        let url = URL(string: "\(baseURL)/notebooks")!
        var request = URLRequest(url: url)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw XxxError.invalidResponse
        }
        
        if httpResponse.statusCode == 401 {
            throw XxxError.sessionExpired
        }
        
        let decoded = try JSONDecoder().decode(XxxAPIResponse<XxxNotebookResponse>.self, from: data)
        return decoded.data?.books ?? []
    }
    
    func fetchHighlights(bookId: String) async throws -> [XxxBookmark] {
        // 实现获取高亮的逻辑
        // ...
    }
}

// MARK: - Errors

enum XxxError: LocalizedError {
    case notLoggedIn
    case sessionExpired
    case invalidResponse
    case apiError(String)
    
    var errorDescription: String? {
        switch self {
        case .notLoggedIn: return "Not logged in to Xxx"
        case .sessionExpired: return "Xxx session expired"
        case .invalidResponse: return "Invalid response from Xxx"
        case .apiError(let msg): return msg
        }
    }
}
```

### 2.4 创建数据库服务（本地数据库数据源）

#### 文件：`SyncNos/Services/DataSources-From/Xxx/XxxDatabaseService.swift`（新建）

```swift
import Foundation
import SQLite3

// MARK: - Protocol

protocol XxxDatabaseServiceProtocol: AnyObject {
    func openDatabase(at path: String) throws -> OpaquePointer
    func fetchBooks(db: OpaquePointer) throws -> [XxxBookListItem]
    func fetchHighlights(db: OpaquePointer, bookId: String) throws -> [XxxBookmark]
    func close(_ db: OpaquePointer?)
}

// MARK: - Implementation

final class XxxDatabaseService: XxxDatabaseServiceProtocol {
    
    private let logger: LoggerServiceProtocol
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    func openDatabase(at path: String) throws -> OpaquePointer {
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
        
        guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK else {
            throw XxxError.databaseOpenFailed
        }
        
        return db!
    }
    
    func fetchBooks(db: OpaquePointer) throws -> [XxxBookListItem] {
        // 实现 SQL 查询逻辑
        // ...
    }
    
    func fetchHighlights(db: OpaquePointer, bookId: String) throws -> [XxxBookmark] {
        // 实现 SQL 查询逻辑
        // ...
    }
    
    func close(_ db: OpaquePointer?) {
        if let db = db {
            sqlite3_close(db)
        }
    }
}
```

### 2.5 创建缓存服务（如需要）

#### 文件：`SyncNos/Services/DataSources-From/Xxx/XxxCacheService.swift`（新建）

```swift
import Foundation
import SwiftData

// MARK: - Protocol

protocol XxxCacheServiceProtocol: AnyObject {
    func getCachedBooks() async -> [XxxBookListItem]
    func cacheBooks(_ books: [XxxBookListItem]) async
    func getCachedHighlights(bookId: String) async -> [XxxBookmark]
    func cacheHighlights(_ highlights: [XxxBookmark], bookId: String) async
}

// MARK: - Implementation

@MainActor
final class XxxCacheService: XxxCacheServiceProtocol {
    
    private let modelContainer: ModelContainer
    private let logger: LoggerServiceProtocol
    
    init(modelContainer: ModelContainer, logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.modelContainer = modelContainer
        self.logger = logger
    }
    
    func getCachedBooks() async -> [XxxBookListItem] {
        let context = modelContainer.mainContext
        let descriptor = FetchDescriptor<CachedXxxBook>()
        
        do {
            let cached = try context.fetch(descriptor)
            return cached.map { XxxBookListItem(from: $0) }
        } catch {
            logger.error("Failed to fetch cached books: \(error)")
            return []
        }
    }
    
    func cacheBooks(_ books: [XxxBookListItem]) async {
        // 实现缓存逻辑
    }
    
    // ... 其他方法
}
```

### 2.6 在 Protocols.swift 中添加协议定义

#### 文件：`SyncNos/Services/Core/Protocols.swift`

```swift
// MARK: - Xxx Service Protocols

/// Xxx 认证服务协议
protocol XxxAuthServiceProtocol: AnyObject {
    var isLoggedIn: Bool { get }
    func getCookieHeader() -> String?
    func saveCookieHeader(_ header: String)
    func clearCredentials()
}

/// Xxx API 服务协议
protocol XxxAPIServiceProtocol: AnyObject {
    func fetchNotebooks() async throws -> [XxxNotebook]
    func fetchHighlights(bookId: String) async throws -> [XxxBookmark]
}

/// Xxx 缓存服务协议（可选）
protocol XxxCacheServiceProtocol: AnyObject {
    func getCachedBooks() async -> [XxxBookListItem]
    func cacheBooks(_ books: [XxxBookListItem]) async
    func getCachedHighlights(bookId: String) async -> [XxxBookmark]
    func cacheHighlights(_ highlights: [XxxBookmark], bookId: String) async
}
```

> **注意**: 将协议定义在 `Protocols.swift` 中可以：
> - 便于依赖注入和测试
> - 避免循环依赖
> - 保持代码组织的一致性

### Checklist

- [ ] 创建 `SyncNos/Services/DataSources-From/Xxx/` 目录
- [ ] 在 `Protocols.swift` 中添加服务协议定义
- [ ] 创建 `XxxAuthService.swift`（如需认证）
- [ ] 创建 `XxxAPIService.swift`（Web API）或 `XxxDatabaseService.swift`（本地数据库）
- [ ] 创建 `XxxCacheService.swift`（如需本地缓存）

---

## 第三阶段：同步适配器

### 3.1 创建 Notion 适配器

#### 文件：`SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/XxxNotionAdapter.swift`（新建）

```swift
import Foundation

/// Xxx 数据源适配器
final class XxxNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let apiService: XxxAPIServiceProtocol
    
    // MARK: - State
    
    private let book: XxxBookListItem
    
    // MARK: - Initialization
    
    init(
        book: XxxBookListItem,
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService
    ) {
        self.book = book
        self.apiService = apiService
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "xxx" }
    
    var databaseTitle: String { "SyncNos-Xxx" }
    
    var highlightSource: HighlightSource { .xxx }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: book)
    }
    
    /// 额外的数据库属性定义
    var additionalPropertyDefinitions: [String: Any] {
        [
            "Author": ["rich_text": [:]],
            "Xxx Book ID": ["rich_text": [:]]
            // 根据需要添加更多属性
        ]
    }
    
    /// 支持的同步策略
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]  // 或 [.singleDatabase, .perBookDatabase]
    }
    
    /// 当前使用的同步策略
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    /// 获取高亮数据
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        let bookmarks = try await apiService.fetchHighlights(bookId: book.bookId)
        return bookmarks.map { UnifiedHighlight(from: $0) }
    }
    
    /// 额外的页面属性
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        if !book.author.isEmpty {
            properties["Author"] = ["rich_text": [["text": ["content": book.author]]]]
        }
        
        properties["Xxx Book ID"] = ["rich_text": [["text": ["content": book.bookId]]]]
        
        return properties
    }
}

// MARK: - Factory

extension XxxNotionAdapter {
    
    /// 创建适配器的工厂方法
    static func create(
        book: XxxBookListItem,
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService
    ) -> XxxNotionAdapter {
        XxxNotionAdapter(book: book, apiService: apiService)
    }
}
```

### 3.2 如需支持 PerBook 策略

如果数据源需要支持"每本书独立数据库"策略，还需实现 `NotionPerBookSyncSourceProtocol`：

```swift
extension XxxNotionAdapter: NotionPerBookSyncSourceProtocol {
    
    var perBookPropertyDefinitions: [String: Any] {
        [
            "Content": ["title": [:]],
            "Note": ["rich_text": [:]],
            "Color": ["select": [:]],
            "Location": ["rich_text": [:]],
            "Created": ["date": [:]]
        ]
    }
    
    func buildHighlightProperties(for highlight: UnifiedHighlight) -> [String: Any] {
        var props: [String: Any] = [
            "Content": ["title": [["text": ["content": highlight.text]]]]
        ]
        
        if let note = highlight.note, !note.isEmpty {
            props["Note"] = ["rich_text": [["text": ["content": note]]]]
        }
        
        // ... 其他属性
        
        return props
    }
}
```

### 3.3 创建特殊 SyncService（可选，如需特殊处理）

如果数据源需要特殊的同步逻辑（如 GoodLinks 需要处理文章内容），可以创建一个 Facade 服务：

#### 文件：`SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/XxxSyncService.swift`（新建）

```swift
import Foundation

/// Xxx 同步服务协议
protocol XxxSyncServiceProtocol: AnyObject {
    func syncHighlights(for item: XxxBookListItem, progress: @escaping (String) -> Void) async throws
}

/// Xxx 同步服务实现（Facade）
/// 使用统一同步引擎处理同步逻辑，但保留 Xxx 特有的处理
final class XxxSyncService: XxxSyncServiceProtocol {
    
    private let syncEngine: NotionSyncEngine
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let apiService: XxxAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.syncEngine = syncEngine
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.apiService = apiService
        self.logger = logger
    }
    
    func syncHighlights(
        for item: XxxBookListItem,
        progress: @escaping (String) -> Void
    ) async throws {
        // 1. 使用适配器进行标准同步
        let adapter = XxxNotionAdapter.create(item: item)
        
        // 2. 如果需要特殊处理（如添加额外内容）
        // 在同步前/后执行特殊逻辑
        
        // 3. 执行同步
        try await syncEngine.syncSmart(source: adapter, progress: progress)
        
        // 4. 同步后的特殊处理（如更新额外属性）
    }
}
```

> **何时需要特殊 SyncService**:
> - 需要在同步前/后执行额外操作
> - 需要处理特殊内容（如文章全文、附件等）
> - 需要自定义同步流程
> - 现有的 `NotionSyncEngine.syncSmart()` 无法满足需求

### Checklist

- [ ] 创建 `XxxNotionAdapter.swift`
- [ ] 实现 `NotionSyncSourceProtocol` 所有必需属性和方法
- [ ] 设置正确的 `sourceKey`、`databaseTitle`、`highlightSource`
- [ ] 实现 `fetchHighlights()` 方法
- [ ] 定义 `additionalPropertyDefinitions`（如需要）
- [ ] 实现 `additionalPageProperties()`（如需要）
- [ ] （可选）实现 `NotionPerBookSyncSourceProtocol`
- [ ] （可选）创建 `XxxSyncService.swift`（如需特殊同步逻辑）

---

## 第四阶段：ViewModel

### 4.1 创建列表 ViewModel

#### 文件：`SyncNos/ViewModels/Xxx/XxxViewModel.swift`（新建）

```swift
import Foundation
import Combine

@MainActor
final class XxxViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    @Published var books: [XxxBookListItem] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var showRefreshFailedAlert: Bool = false
    @Published var refreshFailureReason: String = ""
    
    // 搜索和排序
    @Published var searchText: String = ""
    @Published var sortOption: SortOption = .title
    
    // 同步状态
    @Published var syncingBookIds: Set<String> = []
    @Published var syncProgress: [String: String] = [:]
    
    // MARK: - Dependencies
    
    private let apiService: XxxAPIServiceProtocol
    private let authService: XxxAuthServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let logger: LoggerServiceProtocol
    
    private var cacheService: XxxCacheServiceProtocol?
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    init(
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService,
        authService: XxxAuthServiceProtocol = DIContainer.shared.xxxAuthService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.apiService = apiService
        self.authService = authService
        self.syncEngine = syncEngine
        self.syncTimestampStore = syncTimestampStore
        self.logger = logger
        
        setupBindings()
    }
    
    // MARK: - Public Methods
    
    func setCacheService(_ service: XxxCacheServiceProtocol) {
        self.cacheService = service
    }
    
    func loadBooks() async {
        guard authService.isLoggedIn else {
            errorMessage = "Please login to Xxx first"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        // 先加载缓存
        if let cached = await cacheService?.getCachedBooks(), !cached.isEmpty {
            books = cached
        }
        
        do {
            let notebooks = try await apiService.fetchNotebooks()
            books = notebooks.map { XxxBookListItem(from: $0) }
            
            // 更新缓存
            await cacheService?.cacheBooks(books)
            
        } catch let error as XxxError {
            handleError(error)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func syncBook(_ book: XxxBookListItem) async {
        guard !syncingBookIds.contains(book.bookId) else { return }
        
        syncingBookIds.insert(book.bookId)
        syncProgress[book.bookId] = "Preparing..."
        
        do {
            let adapter = XxxNotionAdapter.create(book: book)
            
            try await syncEngine.syncSmart(source: adapter) { [weak self] progress in
                Task { @MainActor in
                    self?.syncProgress[book.bookId] = progress
                }
            }
            
            syncProgress[book.bookId] = "Completed"
            
        } catch {
            syncProgress[book.bookId] = "Failed: \(error.localizedDescription)"
            logger.error("Sync failed for \(book.title): \(error)")
        }
        
        syncingBookIds.remove(book.bookId)
    }
    
    func getLastSyncTime(for bookId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: bookId)
    }
    
    // MARK: - Navigation
    
    func navigateToXxxLogin() {
        // 发送通知导航到登录页面
        NotificationCenter.default.post(name: Notification.Name("NavigateToXxxSettings"), object: nil)
    }
    
    // MARK: - Private Methods
    
    private func setupBindings() {
        // 搜索过滤等绑定
    }
    
    private func handleError(_ error: XxxError) {
        switch error {
        case .sessionExpired:
            refreshFailureReason = NSLocalizedString("Invalid Xxx cookies. Please login manually.", comment: "")
            showRefreshFailedAlert = true
        default:
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Sort Option

extension XxxViewModel {
    enum SortOption: String, CaseIterable {
        case title
        case author
        case highlightCount
        case lastRead
        
        var displayName: String {
            switch self {
            case .title: return "Title"
            case .author: return "Author"
            case .highlightCount: return "Highlights"
            case .lastRead: return "Last Read"
            }
        }
    }
}
```

### 4.2 创建设置 ViewModel

#### 文件：`SyncNos/ViewModels/Xxx/XxxSettingsViewModel.swift`（新建）

```swift
import Foundation
import Combine

@MainActor
final class XxxSettingsViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    @Published var isLoggedIn: Bool = false
    @Published var showLoginSheet: Bool = false
    @Published var autoSync: Bool = false
    
    // MARK: - Dependencies
    
    private let authService: XxxAuthServiceProtocol
    private let autoSyncService: AutoSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    
    // MARK: - Initialization
    
    init(
        authService: XxxAuthServiceProtocol = DIContainer.shared.xxxAuthService,
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.autoSyncService = autoSyncService
        self.logger = logger
        
        loadSettings()
    }
    
    // MARK: - Public Methods
    
    func loadSettings() {
        isLoggedIn = authService.isLoggedIn
        autoSync = UserDefaults.standard.bool(forKey: "autoSync.xxx")
    }
    
    func logout() {
        authService.clearCredentials()
        isLoggedIn = false
        logger.info("Xxx logged out")
    }
    
    func save() {
        let previous = UserDefaults.standard.bool(forKey: "autoSync.xxx")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.xxx")
        
        // 检查是否需要启动/停止自动同步
        let anyEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
            || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
            || UserDefaults.standard.bool(forKey: "autoSync.weRead")
            || autoSync
        
        if anyEnabled {
            autoSyncService.start()
            if !previous && autoSync {
                autoSyncService.triggerXxxNow()
            }
        } else {
            autoSyncService.stop()
        }
        
        logger.info("Xxx settings saved, autoSync: \(autoSync)")
    }
}
```

### 4.3 创建详情 ViewModel（可选，如需要详情页）

#### 文件：`SyncNos/ViewModels/Xxx/XxxDetailViewModel.swift`（新建）

```swift
import Foundation
import Combine

@MainActor
final class XxxDetailViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    @Published var highlights: [XxxBookmark] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var isSyncing: Bool = false
    @Published var syncProgressText: String?
    
    // 排序和过滤
    @Published var sortField: HighlightSortField = .created
    @Published var isAscending: Bool = false
    
    // MARK: - Dependencies
    
    private let apiService: XxxAPIServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    
    private var book: XxxBookListItem?
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    init(
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.apiService = apiService
        self.syncEngine = syncEngine
        self.notionConfig = notionConfig
        self.logger = logger
    }
    
    // MARK: - Public Methods
    
    func configure(with book: XxxBookListItem) {
        self.book = book
    }
    
    func loadHighlights() async {
        guard let book = book else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            highlights = try await apiService.fetchHighlights(bookId: book.bookId)
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func syncToNotion() async {
        guard let book = book else { return }
        guard !isSyncing else { return }
        
        isSyncing = true
        syncProgressText = "Preparing..."
        
        do {
            let adapter = XxxNotionAdapter.create(book: book)
            
            try await syncEngine.syncSmart(source: adapter) { [weak self] progress in
                Task { @MainActor in
                    self?.syncProgressText = progress
                }
            }
            
            syncProgressText = "Completed"
            
        } catch {
            syncProgressText = "Failed: \(error.localizedDescription)"
            logger.error("Sync failed: \(error)")
        }
        
        isSyncing = false
    }
}
```

### Checklist

- [ ] 创建 `SyncNos/ViewModels/Xxx/` 目录
- [ ] 创建 `XxxViewModel.swift`
- [ ] 创建 `XxxSettingsViewModel.swift`
- [ ] （可选）创建 `XxxDetailViewModel.swift`（如需详情页）
- [ ] 实现书籍加载、同步、错误处理逻辑
- [ ] 实现缓存服务注入（`setCacheService`）
- [ ] 实现导航方法（`navigateToXxxLogin`）

---

## 第五阶段：Views

### 5.1 创建列表视图

#### 文件：`SyncNos/Views/Xxx/XxxListView.swift`（新建）

```swift
import SwiftUI

struct XxxListView: View {
    @StateObject private var viewModel = XxxViewModel()
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        Group {
            if viewModel.books.isEmpty && !viewModel.isLoading {
                emptyStateView
            } else {
                bookListView
            }
        }
        .searchable(text: $viewModel.searchText)
        .toolbar {
            toolbarContent
        }
        .alert(
            NSLocalizedString("Session Expired", comment: ""),
            isPresented: $viewModel.showRefreshFailedAlert
        ) {
            Button(NSLocalizedString("Remind Me Later", comment: ""), role: .cancel) { }
            Button(NSLocalizedString("Go to Login", comment: "")) {
                openWindow(id: "setting")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    NotificationCenter.default.post(name: Notification.Name("NavigateToXxxSettings"), object: nil)
                }
            }
        } message: {
            Text(viewModel.refreshFailureReason)
        }
        .task {
            await viewModel.loadBooks()
        }
    }
    
    // MARK: - Subviews
    
    private var emptyStateView: some View {
        ContentUnavailableView {
            Label("No Books", systemImage: "book.closed")
        } description: {
            Text("Login to Xxx to see your books and highlights.")
        } actions: {
            Button("Go to Settings") {
                openWindow(id: "setting")
            }
        }
    }
    
    private var bookListView: some View {
        List(viewModel.books) { book in
            BookRowView(
                book: book,
                isSyncing: viewModel.syncingBookIds.contains(book.bookId),
                progress: viewModel.syncProgress[book.bookId],
                lastSyncTime: viewModel.getLastSyncTime(for: book.bookId)
            ) {
                Task { await viewModel.syncBook(book) }
            }
        }
    }
    
    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .automatic) {
            Button {
                Task { await viewModel.loadBooks() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(viewModel.isLoading)
        }
    }
}
```

### 5.2 创建设置视图

#### 文件：`SyncNos/Views/Settting/SyncFrom/XxxSettingsView.swift`（新建）

```swift
import SwiftUI

struct XxxSettingsView: View {
    @StateObject private var viewModel = XxxSettingsViewModel()
    
    var body: some View {
        Form {
            Section("Account") {
                if viewModel.isLoggedIn {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Logged in")
                        Spacer()
                        Button("Logout") {
                            viewModel.logout()
                        }
                    }
                } else {
                    HStack {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.red)
                        Text("Not logged in")
                        Spacer()
                        Button("Login") {
                            viewModel.showLoginSheet = true
                        }
                    }
                }
            }
            
            Section("Auto Sync") {
                Toggle("Enable Auto Sync", isOn: $viewModel.autoSync)
                    .onChange(of: viewModel.autoSync) { _, _ in
                        viewModel.save()
                    }
            }
        }
        .navigationTitle("Xxx Settings")
        .sheet(isPresented: $viewModel.showLoginSheet) {
            XxxLoginView {
                viewModel.loadSettings()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("XxxSettingsShowLoginSheet")).receive(on: DispatchQueue.main)) { _ in
            viewModel.showLoginSheet = true
        }
    }
}
```

### 5.3 创建详情视图（可选，如需要详情页）

#### 文件：`SyncNos/Views/Xxx/XxxDetailView.swift`（新建）

```swift
import SwiftUI

struct XxxDetailView: View {
    let book: XxxBookListItem
    @StateObject private var viewModel = XxxDetailViewModel()
    
    var body: some View {
        VStack {
            // 头部信息
            headerView
            
            Divider()
            
            // 高亮列表
            if viewModel.isLoading {
                ProgressView()
            } else if viewModel.highlights.isEmpty {
                ContentUnavailableView {
                    Label("No Highlights", systemImage: "highlighter")
                } description: {
                    Text("This book has no highlights yet.")
                }
            } else {
                highlightListView
            }
        }
        .toolbar {
            toolbarContent
        }
        .onAppear {
            viewModel.configure(with: book)
            Task { await viewModel.loadHighlights() }
        }
    }
    
    // MARK: - Subviews
    
    private var headerView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(book.title)
                .font(.title2)
                .fontWeight(.bold)
            Text(book.author)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Text("\(book.highlightCount) highlights")
                .font(.caption)
        }
        .padding()
    }
    
    private var highlightListView: some View {
        List(viewModel.highlights, id: \.highlightId) { highlight in
            HighlightRowView(highlight: highlight)
        }
    }
    
    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .automatic) {
            Button {
                Task { await viewModel.syncToNotion() }
            } label: {
                if viewModel.isSyncing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
            }
            .disabled(viewModel.isSyncing)
        }
    }
}
```

### 5.4 创建登录视图（如需要）

#### 文件：`SyncNos/Views/Settting/SyncFrom/XxxLoginView.swift`（新建）

```swift
import SwiftUI
import WebKit

struct XxxLoginView: View {
    @Environment(\.dismiss) private var dismiss
    let onLoginChanged: () -> Void
    
    var body: some View {
        VStack {
            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Text("Login to Xxx")
                    .font(.headline)
                Spacer()
                Color.clear.frame(width: 60)
            }
            .padding()
            
            XxxWebView(onCookieCaptured: { cookie in
                DIContainer.shared.xxxAuthService.saveCookieHeader(cookie)
                onLoginChanged()
                NotificationCenter.default.post(name: Notification.Name("XxxLoginSucceeded"), object: nil)
                dismiss()
            })
        }
        .frame(minWidth: 800, minHeight: 600)
    }
}

// WebView 实现...
```

### 5.5 更新 MainListView

#### 文件：`SyncNos/Views/Components/MainListView.swift`

添加新数据源的开关和视图：

```swift
// 添加 AppStorage
@AppStorage("datasource.xxx.enabled") private var xxxSourceEnabled: Bool = false

// 添加 ViewModel
@StateObject private var xxxVM = XxxViewModel()

// 在 availableSources 计算属性中添加
private var availableSources: [ContentSource] {
    var sources: [ContentSource] = []
    if appleBooksSourceEnabled { sources.append(.appleBooks) }
    if goodLinksSourceEnabled { sources.append(.goodLinks) }
    if weReadSourceEnabled { sources.append(.weRead) }
    if xxxSourceEnabled { sources.append(.xxx) }  // ← 添加
    return sources
}

// 在 mainContent 中添加 case
switch contentSource {
// ... 现有 case ...
case .xxx:
    XxxListView()
        .environmentObject(xxxVM)
}

// 在 onAppear 中注入缓存服务
.onAppear {
    // ...
    if let cacheService = DIContainer.shared.xxxCacheService {
        xxxVM.setCacheService(cacheService)
    }
}

// 添加 onChange 监听
.onChange(of: xxxSourceEnabled) { _, _ in
    ensureValidContentSource()
}
```

### 5.6 更新 SettingsView

#### 文件：`SyncNos/Views/Settting/General/SettingsView.swift`

添加新数据源的设置入口：

```swift
// 在 "Data Sources" Section 中添加
NavigationLink(destination: XxxSettingsView()) {
    Label("Xxx", systemImage: "book.fill")
}

// 添加导航目标
.navigationDestination(for: String.self) { destination in
    // ... 现有 case ...
    if destination == "xxxSettings" {
        XxxSettingsView()
    }
}

// 添加通知监听
.onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToXxxSettings"))) { _ in
    navigationPath.append("xxxSettings")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        NotificationCenter.default.post(name: Notification.Name("XxxSettingsShowLoginSheet"), object: nil)
    }
}
```

### Checklist

- [ ] 创建 `SyncNos/Views/Xxx/` 目录
- [ ] 创建 `XxxListView.swift`
- [ ] （可选）创建 `XxxDetailView.swift`（如需详情页）
- [ ] 创建 `XxxSettingsView.swift`
- [ ] 创建 `XxxLoginView.swift`（如需要 WebView 登录）
- [ ] 在 `MainListView.swift` 中添加数据源开关和视图
- [ ] 在 `SettingsView.swift` 中添加设置入口和导航

---

## 第六阶段：自动同步

### 6.1 创建 AutoSyncProvider

#### 文件：`SyncNos/Services/SyncScheduling/XxxAutoSyncProvider.swift`（新建）

```swift
import Foundation

/// Xxx 自动同步提供者
final class XxxAutoSyncProvider: AutoSyncSourceProvider {
    
    let id: SyncSource = .xxx
    let autoSyncUserDefaultsKey: String = "autoSync.xxx"
    let intervalSeconds: TimeInterval
    
    private let logger: LoggerServiceProtocol
    private let apiService: XxxAPIServiceProtocol
    private let authService: XxxAuthServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    
    private var isSyncing: Bool = false
    
    init(
        intervalSeconds: TimeInterval = 24 * 60 * 60,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: XxxAPIServiceProtocol = DIContainer.shared.xxxAPIService,
        authService: XxxAuthServiceProtocol = DIContainer.shared.xxxAuthService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.intervalSeconds = intervalSeconds
        self.logger = logger
        self.apiService = apiService
        self.authService = authService
        self.syncEngine = syncEngine
        self.notionConfig = notionConfig
        self.syncTimestampStore = syncTimestampStore
    }
    
    // MARK: - AutoSyncSourceProvider
    
    func triggerScheduledSyncIfEnabled() {
        runIfNeeded()
    }
    
    func triggerManualSyncNow() {
        runIfNeeded()
    }
    
    // MARK: - Private
    
    private func runIfNeeded() {
        guard !isSyncing else { return }
        
        let enabled = UserDefaults.standard.bool(forKey: autoSyncUserDefaultsKey)
        guard enabled else { return }
        
        guard authService.isLoggedIn else {
            logger.warning("AutoSync[Xxx] skipped: not logged in")
            return
        }
        
        guard notionConfig.isConfigured else {
            logger.warning("AutoSync[Xxx] skipped: Notion not configured")
            return
        }
        
        isSyncing = true
        logger.info("AutoSync[Xxx]: starting")
        
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("AutoSync[Xxx]: finished")
            }
            do {
                try await self.syncAllBooks()
            } catch {
                self.logger.error("AutoSync[Xxx] error: \(error.localizedDescription)")
            }
        }
    }
    
    private func syncAllBooks() async throws {
        let notebooks = try await apiService.fetchNotebooks()
        let books = notebooks.map { XxxBookListItem(from: $0) }
        
        if books.isEmpty {
            logger.info("AutoSync[Xxx]: no books found")
            return
        }
        
        // 过滤近期已同步的书籍
        let now = Date()
        var eligibleBooks: [XxxBookListItem] = []
        for book in books {
            if let last = syncTimestampStore.getLastSyncTime(for: book.bookId),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync[Xxx] skipped \(book.title): recent sync")
                continue
            }
            eligibleBooks.append(book)
        }
        
        if eligibleBooks.isEmpty { return }
        
        // 发送队列通知
        var items: [[String: Any]] = []
        for book in eligibleBooks {
            items.append(["id": book.bookId, "title": book.title, "subtitle": book.author])
        }
        NotificationCenter.default.post(
            name: Notification.Name("SyncTasksEnqueued"),
            object: nil,
            userInfo: ["source": SyncSource.xxx.rawValue, "items": items]
        )
        
        // 并发同步
        let maxConcurrent = NotionSyncConfig.batchConcurrency
        var nextIndex = 0
        
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleBooks.count else { return }
                let book = eligibleBooks[nextIndex]
                nextIndex += 1
                
                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: nil,
                            userInfo: ["bookId": book.bookId, "status": "started"]
                        )
                        do {
                            let adapter = XxxNotionAdapter.create(book: book)
                            try await self.syncEngine.syncSmart(source: adapter) { _ in }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "succeeded"]
                            )
                        } catch {
                            self.logger.error("AutoSync failed for \(book.bookId): \(error)")
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "failed"]
                            )
                        }
                    }
                }
            }
            
            for _ in 0..<min(maxConcurrent, eligibleBooks.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}
```

### 6.2 更新 AutoSyncService

#### 文件：`SyncNos/Services/SyncScheduling/AutoSyncService.swift`

```swift
// 在 init 中添加新的 provider
let xxx = XxxAutoSyncProvider(intervalSeconds: intervalSeconds, logger: logger)
self.providers = [
    .appleBooks: apple,
    .goodLinks: goodLinks,
    .weRead: weRead,
    .xxx: xxx  // ← 添加
]

// 在 start() 中添加通知监听
notificationCancellable = NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
    .merge(with: NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")))
    .merge(with: NotificationCenter.default.publisher(for: Notification.Name("WeReadLoginSucceeded")))
    .merge(with: NotificationCenter.default.publisher(for: Notification.Name("XxxLoginSucceeded")))  // ← 添加
    // ...

// 添加触发方法
func triggerXxxNow() {
    providers[.xxx]?.triggerManualSyncNow()
}
```

### 6.3 更新协议

#### 文件：`SyncNos/Services/Core/Protocols.swift`

```swift
protocol AutoSyncServiceProtocol: AnyObject {
    var isRunning: Bool { get }
    func start()
    func stop()
    func triggerSyncNow()
    func triggerAppleBooksNow()
    func triggerGoodLinksNow()
    func triggerWeReadNow()
    func triggerXxxNow()  // ← 添加
}
```

### 6.4 更新 SyncNosApp

#### 文件：`SyncNos/SyncNosApp.swift`

```swift
let autoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
    || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
    || UserDefaults.standard.bool(forKey: "autoSync.weRead")
    || UserDefaults.standard.bool(forKey: "autoSync.xxx")  // ← 添加
```

### Checklist

- [ ] 创建 `XxxAutoSyncProvider.swift`
- [ ] 在 `AutoSyncService.swift` 中添加新 provider
- [ ] 在 `AutoSyncService.swift` 中添加登录成功通知监听
- [ ] 在 `AutoSyncService.swift` 中添加 `triggerXxxNow()` 方法
- [ ] 在 `Protocols.swift` 的 `AutoSyncServiceProtocol` 中添加 `triggerXxxNow()`
- [ ] 在 `SyncNosApp.swift` 中添加自动同步启用检查

---

## 第七阶段：配置与注册

### 7.1 更新 DIContainer

#### 文件：`SyncNos/Services/Core/DIContainer.swift`

```swift
// 添加私有变量
private var _xxxAuthService: XxxAuthServiceProtocol?
private var _xxxAPIService: XxxAPIServiceProtocol?
private var _xxxCacheService: XxxCacheServiceProtocol?

// 添加计算属性
var xxxAuthService: XxxAuthServiceProtocol {
    if _xxxAuthService == nil {
        _xxxAuthService = XxxAuthService()
    }
    return _xxxAuthService!
}

var xxxAPIService: XxxAPIServiceProtocol {
    if _xxxAPIService == nil {
        _xxxAPIService = XxxAPIService(authService: xxxAuthService)
    }
    return _xxxAPIService!
}

var xxxCacheService: XxxCacheServiceProtocol? {
    if _xxxCacheService == nil {
        // 如果使用 SwiftData，需要配置 ModelContainer
        // ...
    }
    return _xxxCacheService
}

// 添加注册方法
func register(xxxAuthService: XxxAuthServiceProtocol) {
    self._xxxAuthService = xxxAuthService
}

func register(xxxAPIService: XxxAPIServiceProtocol) {
    self._xxxAPIService = xxxAPIService
}
```

### 7.2 添加到 Xcode 项目

确保所有新文件都添加到 Xcode 项目的正确 target 中。

### Checklist

- [ ] 在 `DIContainer.swift` 中添加服务注册
- [ ] 确保所有新文件添加到 Xcode 项目
- [ ] 验证依赖注入正确配置

---

## 第八阶段：国际化

### 8.1 添加本地化字符串

在所有支持的语言文件中添加新数据源相关的字符串：

```
// Localizable.strings

// Data Source Name
"Xxx" = "Xxx";

// Settings
"Xxx Settings" = "Xxx Settings";
"Login to Xxx" = "Login to Xxx";
"Logout from Xxx" = "Logout from Xxx";

// Errors
"Invalid Xxx cookies. Please login manually." = "Invalid Xxx cookies. Please login manually.";
"Not logged in to Xxx" = "Not logged in to Xxx";
"Xxx session expired" = "Xxx session expired";

// Empty State
"No Xxx books found" = "No Xxx books found";
"Login to Xxx to see your books and highlights." = "Login to Xxx to see your books and highlights.";
```

### Checklist

- [ ] 在所有语言的 `Localizable.strings` 中添加新字符串
- [ ] 确保所有用户可见的字符串都使用 `NSLocalizedString`

---

## 第九阶段：测试与验证

### 9.1 功能测试清单

- [ ] 登录功能正常
- [ ] 书籍列表正确加载
- [ ] 高亮数据正确获取
- [ ] 同步到 Notion 成功
- [ ] 增量同步正确工作
- [ ] 自动同步正确触发
- [ ] 错误处理正确显示
- [ ] Session 过期正确提示并导航

### 9.2 构建验证

```bash
# 构建项目
xcodebuild -scheme SyncNos -configuration Debug build

# 检查警告和错误
xcodebuild -scheme SyncNos -configuration Debug build 2>&1 | grep -E "error:|warning:"
```

### Checklist

- [ ] 所有功能测试通过
- [ ] 项目构建成功无错误
- [ ] 无新增警告

---

## 完整文件清单

### 新建文件

| 路径 | 描述 | 必需 |
|------|------|------|
| `SyncNos/Models/XxxModels.swift` | 数据模型 | ✅ |
| `SyncNos/Models/XxxCacheModels.swift` | SwiftData 缓存模型 | 可选 |
| `SyncNos/Services/DataSources-From/Xxx/XxxAuthService.swift` | 认证服务 | 如需认证 |
| `SyncNos/Services/DataSources-From/Xxx/XxxAPIService.swift` | API 服务 | Web API |
| `SyncNos/Services/DataSources-From/Xxx/XxxDatabaseService.swift` | 数据库服务 | 本地数据库 |
| `SyncNos/Services/DataSources-From/Xxx/XxxCacheService.swift` | 缓存服务 | 可选 |
| `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/XxxNotionAdapter.swift` | Notion 适配器 | ✅ |
| `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/XxxSyncService.swift` | 特殊同步服务 | 可选 |
| `SyncNos/ViewModels/Xxx/XxxViewModel.swift` | 列表 ViewModel | ✅ |
| `SyncNos/ViewModels/Xxx/XxxDetailViewModel.swift` | 详情 ViewModel | 可选 |
| `SyncNos/ViewModels/Xxx/XxxSettingsViewModel.swift` | 设置 ViewModel | ✅ |
| `SyncNos/Views/Xxx/XxxListView.swift` | 列表视图 | ✅ |
| `SyncNos/Views/Xxx/XxxDetailView.swift` | 详情视图 | 可选 |
| `SyncNos/Views/Settting/SyncFrom/XxxSettingsView.swift` | 设置视图 | ✅ |
| `SyncNos/Views/Settting/SyncFrom/XxxLoginView.swift` | 登录视图 | 如需 WebView 登录 |
| `SyncNos/Services/SyncScheduling/XxxAutoSyncProvider.swift` | 自动同步提供者 | ✅ |

### 修改文件

| 路径 | 修改内容 |
|------|----------|
| `SyncNos/Models/SyncQueueModels.swift` | 添加 `SyncSource.xxx` |
| `SyncNos/Models/Models.swift` | 添加 `ContentSource.xxx` 和显示名称 |
| `SyncNos/Models/HighlightColorScheme.swift` | 添加 `HighlightSource.xxx` 和颜色映射 |
| `SyncNos/Models/UnifiedHighlight.swift` | 添加 `UnifiedHighlight` 和 `UnifiedSyncItem` 转换初始化器 |
| `SyncNos/Services/Core/Protocols.swift` | 添加服务协议定义和 `triggerXxxNow()` |
| `SyncNos/Services/Core/DIContainer.swift` | 添加服务注册和计算属性 |
| `SyncNos/Services/SyncScheduling/AutoSyncService.swift` | 添加 provider、通知监听和触发方法 |
| `SyncNos/Views/Components/MainListView.swift` | 添加 `@AppStorage`、ViewModel、视图切换、缓存注入 |
| `SyncNos/Views/Settting/General/SettingsView.swift` | 添加设置入口、导航目标和通知监听 |
| `SyncNos/SyncNosApp.swift` | 添加自动同步启用检查 |
| `Localizable.strings` (所有 16 种语言) | 添加本地化字符串 |

---

## 快速参考

### UserDefaults Keys

| Key | 用途 |
|-----|------|
| `datasource.xxx.enabled` | 数据源启用开关 |
| `autoSync.xxx` | 自动同步启用开关 |

### Notification Names

| Name | 用途 |
|------|------|
| `XxxLoginSucceeded` | 登录成功 |
| `NavigateToXxxSettings` | 导航到设置页 |
| `XxxSettingsShowLoginSheet` | 显示登录 Sheet |

### Keychain Keys

| Key | 用途 |
|-----|------|
| `xxx.cookie` | 存储认证 Cookie |

---

## 常见问题 (FAQ)

### Q1: 什么时候需要 DetailView 和 DetailViewModel？

当用户需要查看单本书/文章的详细高亮列表时需要。如果列表视图已经显示了足够的信息，可以不创建。

**参考**：
- Apple Books 和 WeRead 有 DetailView（显示书籍的所有高亮）
- GoodLinks 没有单独的 DetailView（在列表中直接显示）

### Q2: 什么时候需要特殊的 SyncService？

当 `NotionSyncEngine.syncSmart()` 无法满足需求时，例如：
- 需要在同步前/后执行额外操作
- 需要处理特殊内容（如文章全文）
- 需要自定义同步流程

**参考**：GoodLinks 有 `GoodLinksSyncService` 处理文章内容

### Q3: 本地数据库 vs Web API 数据源的区别？

| 特性 | 本地数据库 | Web API |
|------|-----------|---------|
| 认证 | 通常不需要 | 需要 Cookie/OAuth/API Key |
| 数据访问 | SQLite 直接读取 | HTTP 请求 |
| 缓存 | 可选（数据已在本地） | 推荐（减少 API 调用） |
| 示例 | Apple Books, GoodLinks | WeRead |

### Q4: 如何处理 Session 过期？

1. 在 API 服务中检测 401/过期错误
2. 抛出 `XxxError.sessionExpired`
3. 在 ViewModel 中捕获并设置 `showRefreshFailedAlert = true`
4. 在 View 中显示 Alert，提供"Go to Login"按钮
5. 通过 NotificationCenter 导航到设置页并打开登录 Sheet

### Q5: 为什么需要在 Protocols.swift 中定义协议？

- 便于依赖注入和单元测试
- 避免循环依赖
- 保持代码组织一致性
- 支持 mock 对象

### Q6: 自动同步的触发时机？

1. **定时触发**：`AutoSyncService` 的定时器（默认 24 小时间隔）
2. **登录成功**：发送 `XxxLoginSucceeded` 通知
3. **手动触发**：用户在设置中启用自动同步时
4. **刷新请求**：`RefreshBooksRequested` 通知

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 1.0 | 2025-11-25 | 初始版本 |
| 1.1 | 2025-11-25 | 添加 DetailView/DetailViewModel、特殊 SyncService、FAQ |

---

*文档版本: 1.1*
*最后更新: 2025-11-25*

