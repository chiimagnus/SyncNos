# 得到(Dedao) 数据源实现计划

> 基于 `ADD_NEW_DATASOURCE_CHECKLIST.md` 模板创建
> 
> **数据源类型**: Web API（参考 `WeRead` 实现）
> **认证方式**: Cookie 认证 + 扫码登录
> **同步策略**: SingleDB（单一数据库）

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
10. [第八阶段：测试与验证](#第八阶段测试与验证)
11. [完整文件清单](#完整文件清单)
12. [得到特有注意事项](#得到特有注意事项)
13. [常见问题](#常见问题-faq)

---

## 概述

### 架构模式

```
┌─────────────────────────────────────────────────────────────────┐
│                           Views                                  │
│         (DedaoListView, DedaoSettingsView, DedaoLoginView)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ViewModels                                │
│              (DedaoViewModel, DedaoSettingsViewModel)            │
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
│         DedaoNotionAdapter - 将数据源转换为 UnifiedHighlight     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DataSource Service                            │
│         (DedaoAPIService + DedaoAuthService - 读取原始数据)      │
└─────────────────────────────────────────────────────────────────┘
```

### 命名约定

| 类型 | 命名模式 | 参考文件 |
|------|----------|----------|
| 数据模型 | `DedaoModels.swift` | `WeReadModels.swift` |
| **本地存储模型** | `DedaoCacheModels.swift` | `WeReadCacheModels.swift` |
| API 服务 | `DedaoAPIService.swift` | `WeReadAPIService.swift` |
| 认证服务 | `DedaoAuthService.swift` | `WeReadAuthService.swift` |
| **本地存储服务** | `DedaoCacheService.swift` | `WeReadCacheService.swift` |
| 适配器 | `DedaoNotionAdapter.swift` | `WeReadNotionAdapter.swift` |
| ViewModel | `DedaoViewModel.swift` | `WeReadViewModel.swift` |
| ListView | `DedaoListView.swift` | `WeReadListView.swift` |
| SettingsView | `DedaoSettingsView.swift` | `WeReadSettingsView.swift` |
| AutoSyncProvider | `DedaoAutoSyncProvider.swift` | `WeReadAutoSyncProvider.swift` |

### 可用 API

| API | 端点 | 说明 | 必需 |
|-----|------|------|------|
| **电子书笔记** ⭐ | `POST /api/pc/ledgers/ebook/list` | 获取用户划线和备注 | ✅ |
| 电子书列表 | `POST /api/hades/v2/product/list` | 获取用户书架 | ✅ |
| 电子书详情 | `GET /pc/ebook2/v1/pc/detail` | 获取书籍元数据 | 可选 |
| 用户信息 | `GET /api/pc/user/info` | 验证登录状态 | ✅ |
| 扫码登录 | `/oauth/api/embedded/qrcode` | 二维码登录 | ✅ |

### 功能范围

```
得到 (Dedao) 数据源
├── ✅ 核心功能：电子书笔记同步
│   ├── note_line: 划线内容 → highlightText
│   ├── note: 用户备注 → annotationText
│   └── extra.book_section: 章节信息
│
├── ✅ 认证功能
│   ├── 扫码登录 (WebView)
│   ├── Cookie 管理
│   └── Session 验证
│
└── ❌ 不实现（API 不支持或非核心需求）
    ├── 课程笔记（API 只提供公开评论，不是用户私有笔记）
    ├── 电子书原文（需要 AES 解密 SVG，复杂度高）
    └── 课程原文（非核心需求）
```

---

## 前置准备

### Checklist

- [x] 确定数据源类型：Web API
- [x] 研究数据源的数据结构：电子书 + 笔记
- [x] 确定认证方式：Cookie + 扫码登录
- [x] 确定同步策略：SingleDB（只支持单一数据库模式）

### 数据结构分析

| 得到数据 | SyncNos 映射 |
|---------|-------------|
| `note_line` | `UnifiedHighlight.highlightText` |
| `note` | `UnifiedHighlight.annotationText` |
| `extra.title` | `UnifiedHighlight.chapterTitle` |
| `extra.book_section` | `UnifiedHighlight.location` |
| `create_time` | `UnifiedHighlight.createdAt` |
| `update_time` | `UnifiedHighlight.modifiedAt` |

---

## 第一阶段：数据模型

### 1.1 添加数据源枚举值

需要在以下三个文件中添加新数据源的枚举值：

| 文件 | 枚举 | 添加内容 |
|------|------|----------|
| `Models/SyncQueueModels.swift` | `SyncSource` | `case dedao` |
| `Models/Models.swift` | `ContentSource` | `case dedao` + 显示名称 |
| `Models/HighlightColorScheme.swift` | `HighlightSource` | `case dedao` + 颜色映射 |

> **参考**: 搜索现有的 `weRead` case 查看添加位置

#### 1.1.1 SyncSource 枚举

```swift
// Models/SyncQueueModels.swift
enum SyncSource: String, Codable {
    case appleBooks
    case goodLinks
    case weRead
    case dedao       // ← 添加
}
```

#### 1.1.2 ContentSource 枚举

```swift
// Models/Models.swift
enum ContentSource: Int, Codable, CaseIterable {
    case appleBooks = 0
    case goodLinks = 1
    case weRead = 2
    case dedao = 3   // ← 添加
    
    var title: String {
        switch self {
        // ...
        case .dedao: return String(localized: "source.dedao")
        }
    }
    
    var icon: String {
        switch self {
        // ...
        case .dedao: return "book.closed.fill"
        }
    }
}
```

#### 1.1.3 HighlightSource 枚举

```swift
// Models/HighlightColorScheme.swift
enum HighlightSource: String, CaseIterable {
    case appleBooks
    case goodLinks
    case weRead
    case dedao       // ← 添加
}

// 在 HighlightColorScheme.allDefinitions 中添加
static let allDefinitions: [HighlightSource: [HighlightColorDefinition]] = [
    // ...
    .dedao: [
        HighlightColorDefinition(
            colorIndex: 0,
            displayName: "Default",
            swiftUIColor: .orange,
            notionColor: "orange"
        )
    ]
]
```

### 1.2 创建数据模型文件

**文件**: `SyncNos/Models/DedaoModels.swift`

```swift
import Foundation

// MARK: - API 响应包装
struct DedaoResponse<T: Codable>: Codable {
    let h: DedaoResponseHeader
    let c: T?
}

struct DedaoResponseHeader: Codable {
    let c: Int           // 状态码，0 表示成功
    let e: String        // 错误信息
    let s: Int
    let t: Int64
}

// MARK: - 电子书模型
struct DedaoEbook: Codable, Identifiable {
    let id: Int
    let enid: String           // 加密 ID（用作唯一标识）
    let title: String
    let author: String?
    let icon: String?          // 封面图
    let intro: String?
    let progress: Int?         // 阅读进度
    let price: String?
    let isVipBook: Int?
    
    private enum CodingKeys: String, CodingKey {
        case id, enid, title, author, icon, intro, progress, price
        case isVipBook = "is_vip_book"
    }
}

// MARK: - 书籍列表响应
struct DedaoEbookListResponse: Codable {
    let list: [DedaoEbook]
    let total: Int
    let isMore: Int
    
    private enum CodingKeys: String, CodingKey {
        case list, total
        case isMore = "is_more"
    }
}

// MARK: - 电子书笔记模型
struct DedaoEbookNote: Codable, Identifiable {
    let noteId: Int64
    let noteIdStr: String
    let noteIdHazy: String
    let uid: Int
    let isFromMe: Int          // 1 = 自己的笔记
    let notesOwner: DedaoNotesOwner
    let noteType: Int
    let sourceType: Int
    let note: String           // 用户备注 → annotationText
    let noteTitle: String
    let noteLine: String       // 划线内容 → highlightText
    let noteLineStyle: String
    let createTime: Int64
    let updateTime: Int64
    let tips: String
    let shareUrl: String
    let extra: DedaoNoteExtra
    let notesCount: DedaoNotesCount
    let canEdit: Bool
    let isPermission: Bool
    
    var id: Int64 { noteId }
    
    private enum CodingKeys: String, CodingKey {
        case noteId = "note_id"
        case noteIdStr = "note_id_str"
        case noteIdHazy = "note_id_hazy"
        case uid
        case isFromMe = "is_from_me"
        case notesOwner = "notes_owner"
        case noteType = "note_type"
        case sourceType = "source_type"
        case note
        case noteTitle = "note_title"
        case noteLine = "note_line"
        case noteLineStyle = "note_line_style"
        case createTime = "create_time"
        case updateTime = "update_time"
        case tips
        case shareUrl = "share_url"
        case extra
        case notesCount = "notes_count"
        case canEdit = "can_edit"
        case isPermission = "is_permission"
    }
}

struct DedaoNoteExtra: Codable {
    let title: String          // 章节标题
    let sourceType: Int
    let sourceTypeName: String
    let bookId: Int
    let bookName: String
    let bookSection: String    // 章节标识
    let bookStartPos: Int
    let bookOffset: Int
    let bookAuthor: String
    
    private enum CodingKeys: String, CodingKey {
        case title
        case sourceType = "source_type"
        case sourceTypeName = "source_type_name"
        case bookId = "book_id"
        case bookName = "book_name"
        case bookSection = "book_section"
        case bookStartPos = "book_start_pos"
        case bookOffset = "book_offset"
        case bookAuthor = "book_author"
    }
}

struct DedaoNotesOwner: Codable {
    let id: String
    let uid: Int
    let name: String
    let avatar: String
}

struct DedaoNotesCount: Codable {
    let repostCount: Int
    let commentCount: Int
    let likeCount: Int
    let wordCount: Int
    
    private enum CodingKeys: String, CodingKey {
        case repostCount = "repost_count"
        case commentCount = "comment_count"
        case likeCount = "like_count"
        case wordCount = "word_count"
    }
}

// MARK: - 笔记列表响应
struct DedaoEbookNotesResponse: Codable {
    let list: [DedaoEbookNote]
}

// MARK: - 用户信息
struct DedaoUserInfo: Codable {
    let uid: Int
    let nickname: String
    let avatar: String
    let phone: String?
    let isVip: Bool?
    
    private enum CodingKeys: String, CodingKey {
        case uid, nickname, avatar, phone
        case isVip = "is_vip"
    }
}

// MARK: - UI 列表模型
struct DedaoBookListItem: Identifiable, Hashable {
    let bookId: String         // enid
    let title: String
    let author: String
    let cover: String
    var highlightCount: Int
    
    var id: String { bookId }
    
    init(from ebook: DedaoEbook, highlightCount: Int = 0) {
        self.bookId = ebook.enid
        self.title = ebook.title
        self.author = ebook.author ?? ""
        self.cover = ebook.icon ?? ""
        self.highlightCount = highlightCount
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(bookId)
    }
    
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.bookId == rhs.bookId
    }
}

// MARK: - 扫码登录相关
struct DedaoQRCodeResponse: Codable {
    let qrCodeString: String
    let qrCodeImage: String    // Base64 图片
    let expire: Int
    
    private enum CodingKeys: String, CodingKey {
        case qrCodeString = "qrcode_string"
        case qrCodeImage = "qrcode_image"
        case expire
    }
}

struct DedaoCheckLoginResponse: Codable {
    let status: Int            // 0-等待扫码, 1-已扫码待确认, 2-登录成功, -1-二维码过期
    let msg: String
    let data: DedaoLoginData?
}

struct DedaoLoginData: Codable {
    let uid: Int?
    let token: String?
}
```

### 1.3 添加 UnifiedHighlight 转换

**文件**: `SyncNos/Models/UnifiedHighlight.swift`

```swift
// MARK: - Dedao Conversions

extension UnifiedHighlight {
    /// 从得到电子书笔记创建
    init(from note: DedaoEbookNote) {
        self.init(
            id: note.noteIdStr,
            bookId: note.extra.bookName,
            highlightText: note.noteLine,
            annotationText: note.note.isEmpty ? nil : note.note,
            chapterTitle: note.extra.title,
            location: note.extra.bookSection,
            createdAt: Date(timeIntervalSince1970: TimeInterval(note.createTime)),
            modifiedAt: Date(timeIntervalSince1970: TimeInterval(note.updateTime)),
            colorIndex: 0  // 得到不提供颜色信息，使用默认
        )
    }
}

extension UnifiedSyncItem {
    /// 从得到书籍列表项创建
    init(from book: DedaoBookListItem) {
        self.init(
            id: book.bookId,
            title: book.title,
            author: book.author,
            coverURL: book.cover,
            highlightCount: book.highlightCount
        )
    }
}
```

### 1.4 创建本地存储模型（SwiftData）

**文件**: `SyncNos/Models/DedaoCacheModels.swift`

> **参考**: `WeReadCacheModels.swift`

```swift
import Foundation
import SwiftData

// MARK: - Cached Dedao Book

/// 本地存储的得到电子书元数据
@Model
final class CachedDedaoBook {
    @Attribute(.unique) var bookId: String  // enid
    var title: String
    var author: String
    var cover: String?
    var highlightCount: Int
    var lastFetchedAt: Date?
    
    @Relationship(deleteRule: .cascade, inverse: \CachedDedaoHighlight.book)
    var highlights: [CachedDedaoHighlight]?
    
    init(bookId: String, title: String, author: String, cover: String? = nil, highlightCount: Int = 0) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.cover = cover
        self.highlightCount = highlightCount
    }
    
    /// 从 API DTO 创建本地存储模型
    convenience init(from ebook: DedaoEbook) {
        self.init(
            bookId: ebook.enid,
            title: ebook.title,
            author: ebook.author ?? "",
            cover: ebook.icon
        )
    }
}

// MARK: - Cached Dedao Highlight

/// 本地存储的得到电子书笔记
@Model
final class CachedDedaoHighlight {
    @Attribute(.unique) var highlightId: String  // noteIdStr
    var bookId: String
    var text: String           // noteLine
    var note: String?          // note
    var chapterTitle: String?  // extra.title
    var createdAt: Date?
    var updatedAt: Date?
    
    var book: CachedDedaoBook?
    
    init(highlightId: String, bookId: String, text: String, note: String? = nil, 
         chapterTitle: String? = nil, createdAt: Date? = nil, updatedAt: Date? = nil) {
        self.highlightId = highlightId
        self.bookId = bookId
        self.text = text
        self.note = note
        self.chapterTitle = chapterTitle
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// 从 API DTO 创建本地存储模型
    convenience init(from note: DedaoEbookNote) {
        self.init(
            highlightId: note.noteIdStr,
            bookId: note.extra.bookName,
            text: note.noteLine,
            note: note.note.isEmpty ? nil : note.note,
            chapterTitle: note.extra.title,
            createdAt: Date(timeIntervalSince1970: TimeInterval(note.createTime)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(note.updateTime))
        )
    }
}

// MARK: - Dedao Sync State

/// 全局同步状态
@Model
final class DedaoSyncState {
    @Attribute(.unique) var id: String
    var lastFullSyncAt: Date?
    var lastIncrementalSyncAt: Date?
    
    init() {
        self.id = "global"
    }
}

// MARK: - Conversion Extensions

extension DedaoBookListItem {
    /// 从本地存储模型创建 UI 列表模型
    init(from cached: CachedDedaoBook) {
        self.init(
            bookId: cached.bookId,
            title: cached.title,
            author: cached.author,
            cover: cached.cover ?? "",
            highlightCount: cached.highlightCount
        )
    }
}
```

### Checklist - 第一阶段

- [x] 在 `SyncSource` 枚举中添加 `case dedao`
- [x] 在 `ContentSource` 枚举中添加 `case dedao` 和显示名称
- [x] 在 `HighlightSource` 枚举中添加 `case dedao`
- [x] 在 `HighlightColorScheme.allDefinitions` 中添加颜色映射
- [x] 创建 `Models/DedaoModels.swift`
- [x] 在 `UnifiedHighlight.swift` 中添加转换初始化器
- [ ] **创建 `Models/DedaoCacheModels.swift`（SwiftData 本地存储模型）**

---

## 第二阶段：数据读取服务

### 2.1 创建服务目录

```bash
mkdir -p SyncNos/Services/DataSources-From/Dedao
```

### 2.2 在 Protocols.swift 中添加协议定义

**文件**: `SyncNos/Services/Core/Protocols.swift`

```swift
// MARK: - Dedao Protocols

/// 得到认证服务协议
protocol DedaoAuthServiceProtocol: AnyObject {
    var isLoggedIn: Bool { get }
    var cookie: String? { get }
    var csrfToken: String? { get }
    func saveCookie(_ cookie: String)
    func clearCookie()
    func validateSession() async -> Bool
}

/// 得到 API 服务协议
protocol DedaoAPIServiceProtocol: AnyObject {
    func setAuthService(_ authService: DedaoAuthServiceProtocol)
    func fetchUserInfo() async throws -> DedaoUserInfo
    func fetchEbookList(category: String, page: Int, pageSize: Int) async throws -> [DedaoEbook]
    func fetchEbookNotes(bookEnid: String) async throws -> [DedaoEbookNote]
}
```

> **参考**: 搜索 `WeReadAuthServiceProtocol` 查看协议定义格式

### 2.3 创建认证服务

**文件**: `SyncNos/Services/DataSources-From/Dedao/DedaoAuthService.swift`

> **参考**: `WeReadAuthService.swift`

关键功能：
- Cookie 存储（使用 `KeychainHelper`）
- CSRF Token 提取
- 会话验证

### 2.4 创建 API 服务

**文件**: `SyncNos/Services/DataSources-From/Dedao/DedaoAPIService.swift`

> **参考**: `WeReadAPIService.swift`

关键功能：
- HTTP 请求封装
- 错误处理（401, 429, 496）
- 速率限制（使用 Actor）

### 2.5 创建速率限制器

**文件**: 在 `DedaoAPIService.swift` 中内嵌

```swift
/// 得到 API 速率限制器
actor DedaoRateLimiter {
    private var tokens: Int = 5
    private let maxTokens: Int = 5
    private let refillRate: Double = 0.5  // 每秒恢复 0.5 个令牌
    private var lastRefillTime: Date = Date()
    
    func waitForNextRequest() async {
        // 令牌桶算法实现
        // 参考 dedao-gui 的 requestLimiter
    }
}
```

### 2.6 创建本地存储服务

**文件**: `SyncNos/Services/DataSources-From/Dedao/DedaoCacheService.swift`

> **参考**: `WeReadCacheService.swift`

本地存储服务职责：
- 从 SwiftData 读取/写入数据
- 提供快速的本地数据访问
- 管理数据生命周期
- 减少 API 调用次数（降低反爬虫风险）

```swift
import Foundation
import SwiftData

/// 得到本地存储服务协议
protocol DedaoCacheServiceProtocol: AnyObject {
    func getCachedBooks() async throws -> [CachedDedaoBook]
    func getCachedHighlights(for bookId: String) async throws -> [CachedDedaoHighlight]
    func saveBooks(_ books: [DedaoEbook]) async throws
    func saveHighlights(_ highlights: [DedaoEbookNote], for bookId: String) async throws
    func updateHighlightCount(for bookId: String, count: Int) async throws
    func clearCache() async throws
}

/// 得到本地存储服务实现
@MainActor
final class DedaoCacheService: DedaoCacheServiceProtocol {
    private let modelContainer: ModelContainer
    
    init(modelContainer: ModelContainer) {
        self.modelContainer = modelContainer
    }
    
    // 实现数据读写逻辑...
}
```

### Checklist - 第二阶段

- [ ] 创建 `Services/DataSources-From/Dedao/` 目录
- [ ] 在 `Protocols.swift` 中添加 `DedaoAuthServiceProtocol`
- [ ] 在 `Protocols.swift` 中添加 `DedaoAPIServiceProtocol`
- [ ] **在 `Protocols.swift` 中添加 `DedaoCacheServiceProtocol`**
- [ ] 创建 `DedaoAuthService.swift`
- [ ] 创建 `DedaoAPIService.swift`
- [ ] **创建 `DedaoCacheService.swift`（本地存储服务）**
- [ ] 实现速率限制器 `DedaoRateLimiter`

---

## 第三阶段：同步适配器

### 3.1 创建 Notion 适配器

**文件**: `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/DedaoNotionAdapter.swift`

实现 `NotionSyncSourceProtocol`：

| 属性/方法 | 说明 |
|----------|------|
| `sourceKey` | `"dedao"` |
| `databaseTitle` | `"SyncNos-Dedao"` |
| `highlightSource` | `.dedao` |
| `syncItem` | 返回 `UnifiedSyncItem` |
| `fetchHighlights()` | 调用 `apiService.fetchEbookNotes()` |
| `additionalPropertyDefinitions` | 添加 Source 属性 |
| `additionalPageProperties()` | 返回 Source = "得到" |

> **参考**: `WeReadNotionAdapter.swift`

### Checklist - 第三阶段

- [ ] 创建 `DedaoNotionAdapter.swift`
- [ ] 实现 `NotionSyncSourceProtocol` 所有必需属性和方法
- [ ] 实现 `fetchHighlights()` 方法

---

## 第四阶段：ViewModel

### 4.1 创建 ViewModel 目录和文件

```bash
mkdir -p SyncNos/ViewModels/Dedao
```

### 4.2 创建 DedaoViewModel

**文件**: `SyncNos/ViewModels/Dedao/DedaoViewModel.swift`

> **参考**: `WeReadViewModel.swift`

#### 必须实现的方法

| 方法 | 说明 | 参考 |
|------|------|------|
| `loadBooks()` | 加载电子书列表 | `WeReadViewModel.loadBooks()` |
| `syncBook(_:)` | 同步单本书 | `WeReadViewModel.syncBook(_:)` |
| `batchSync(bookIds:concurrency:)` | 批量同步 | `WeReadViewModel.batchSync(...)` |
| `setAPIService(_:)` | 注入 API 服务 | - |
| `navigateToDedaoLogin()` | 导航到登录页 | `WeReadViewModel.navigateToWeReadLogin()` |
| `getLastSyncTime(for:)` | 获取上次同步时间 | `WeReadViewModel.getLastSyncTime(for:)` |

#### 必须暴露的属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `books` / `displayBooks` | `[DedaoBookListItem]` | 书籍列表 |
| `isLoading` | `Bool` | 加载状态 |
| `errorMessage` | `String?` | 错误信息 |
| `syncingBookIds` | `Set<String>` | 正在同步的书籍 ID |
| `syncProgress` | `[String: String]` | 同步进度 |
| `showRefreshFailedAlert` | `Bool` | 显示刷新失败弹窗 |
| `refreshFailureReason` | `String` | 刷新失败原因 |

### 4.3 创建 DedaoSettingsViewModel

**文件**: `SyncNos/ViewModels/Dedao/DedaoSettingsViewModel.swift`

> **参考**: `WeReadSettingsViewModel.swift`

### Checklist - 第四阶段

- [ ] 创建 `ViewModels/Dedao/` 目录
- [ ] 创建 `DedaoViewModel.swift`
- [ ] 创建 `DedaoSettingsViewModel.swift`
- [ ] 实现所有必需方法
- [ ] 暴露所有必需属性
- [ ] 实现书籍加载、同步、错误处理逻辑

---

## 第五阶段：Views

### 5.1 创建视图目录和文件

```bash
mkdir -p SyncNos/Views/Dedao
```

### 5.2 需要创建的文件

| 文件 | 说明 | 必需 |
|------|------|------|
| `Views/Dedao/DedaoListView.swift` | 电子书列表视图 | ✅ |
| `Views/Settting/SyncFrom/DedaoSettingsView.swift` | 设置视图 | ✅ |
| `Views/Settting/SyncFrom/DedaoLoginView.swift` | 扫码登录 WebView | ✅ |

> **参考**: `Views/WeRead/WeReadListView.swift`

#### ListView 必需参数

```swift
struct DedaoListView: View {
    @ObservedObject var viewModel: DedaoViewModel
    @Binding var selectionIds: Set<String>
    // ...
}
```

### 5.3 更新 MainListView

**文件**: `SyncNos/Views/Components/MainListView.swift`

#### 5.3.1 添加状态变量（文件顶部）

```swift
// 1. 数据源启用开关
@AppStorage("datasource.dedao.enabled") private var dedaoSourceEnabled: Bool = false

// 2. 选中项 ID 集合
@State private var selectedDedaoIds: Set<String> = []

// 3. ViewModel
@StateObject private var dedaoVM = DedaoViewModel()
```

> **参考**: 搜索 `weReadSourceEnabled`、`selectedWeReadBookIds`、`weReadVM`

#### 5.3.2 更新 isSourceEnabled 函数

```swift
private func isSourceEnabled(_ source: ContentSource) -> Bool {
    switch source {
    // ... 现有 case ...
    case .dedao:
        return dedaoSourceEnabled
    }
}
```

#### 5.3.3 更新 masterColumn（列表视图切换）

```swift
switch contentSource {
// ... 现有 case ...
case .dedao:
    DedaoListView(viewModel: dedaoVM, selectionIds: $selectedDedaoIds)
}
```

#### 5.3.4 更新 detailColumn（详情视图切换）

```swift
else if contentSource == .dedao {
    if selectedDedaoIds.count == 1 {
        // 单选：显示详情视图（可选）
        // 或者显示空占位符
    } else {
        SelectionPlaceholderView(
            title: contentSource.title,
            count: selectedDedaoIds.isEmpty ? nil : selectedDedaoIds.count,
            onSyncSelected: selectedDedaoIds.isEmpty ? nil : {
                let items = selectedDedaoIds.compactMap { id -> [String: Any]? in
                    guard let b = dedaoVM.displayBooks.first(where: { $0.bookId == id }) else { return nil }
                    return ["id": id, "title": b.title, "subtitle": b.author]
                }
                NotificationCenter.default.post(
                    name: Notification.Name("SyncTasksEnqueued"),
                    object: nil,
                    userInfo: ["source": "dedao", "items": items]
                )
                dedaoVM.batchSync(bookIds: selectedDedaoIds, concurrency: NotionSyncConfig.batchConcurrency)
            }
        )
    }
}
```

#### 5.3.5 更新选择清除逻辑

在处理选择变化的地方，添加 `selectedDedaoIds.removeAll()`

#### 5.3.6 在 onAppear 中注入服务

```swift
.onAppear {
    // ...
    if let apiService = DIContainer.shared.dedaoAPIService {
        dedaoVM.setAPIService(apiService)
    }
}
```

#### 5.3.7 添加 onChange 监听

```swift
.onChange(of: dedaoSourceEnabled) { _, _ in
    ensureValidContentSource()
}
```

### 5.4 更新 SettingsView

**文件**: `SyncNos/Views/Settting/General/SettingsView.swift`

添加：
1. `NavigationLink` 到 `DedaoSettingsView`
2. `navigationDestination` 处理 `"dedaoSettings"`
3. `onReceive` 监听 `NavigateToDedaoSettings` 通知

> **参考**: 搜索 `weReadSettings` 查看添加位置

### Checklist - 第五阶段

- [ ] 创建 `Views/Dedao/` 目录
- [ ] 创建 `DedaoListView.swift`
- [ ] 创建 `Views/Settting/SyncFrom/DedaoSettingsView.swift`
- [ ] 创建 `Views/Settting/SyncFrom/DedaoLoginView.swift`（扫码登录 WebView）
- [ ] **MainListView.swift** 更新：
  - [ ] 添加 `@AppStorage` 开关
  - [ ] 添加 `@State` 选中 ID 集合
  - [ ] 添加 `@StateObject` ViewModel
  - [ ] 更新 `isSourceEnabled()` 函数
  - [ ] 更新 `masterColumn` 视图切换
  - [ ] 更新 `detailColumn` 视图切换
  - [ ] 更新选择清除逻辑
  - [ ] 在 `onAppear` 中注入服务
  - [ ] 添加 `onChange` 监听
- [ ] 在 `SettingsView.swift` 中添加设置入口和导航

---

## 第六阶段：自动同步

### 6.1 创建 AutoSyncProvider

**文件**: `SyncNos/Services/SyncScheduling/DedaoAutoSyncProvider.swift`

实现 `AutoSyncSourceProvider` 协议。

> **参考**: `WeReadAutoSyncProvider.swift`

### 6.2 更新 AutoSyncService

**文件**: `SyncNos/Services/SyncScheduling/AutoSyncService.swift`

1. 在 `init` 中创建并添加 `DedaoAutoSyncProvider` 到 `providers` 字典
2. 在 `start()` 中添加 `DedaoLoginSucceeded` 通知监听
3. 添加 `triggerDedaoNow()` 方法

> **参考**: 搜索 `weRead` 查看添加位置

### 6.3 更新协议和 App 入口

1. **Protocols.swift**: 在 `AutoSyncServiceProtocol` 中添加 `triggerDedaoNow()`
2. **SyncNosApp.swift**: 在 `autoSyncEnabled` 检查中添加 `autoSync.dedao`

### Checklist - 第六阶段

- [ ] 创建 `DedaoAutoSyncProvider.swift`
- [ ] 在 `AutoSyncService.swift` 中添加 provider
- [ ] 在 `AutoSyncService.swift` 中添加通知监听和触发方法
- [ ] 在 `Protocols.swift` 中添加 `triggerDedaoNow()`
- [ ] 在 `SyncNosApp.swift` 中添加自动同步检查

---

## 第七阶段：配置与注册

### 7.1 更新 DIContainer

**文件**: `SyncNos/Services/Core/DIContainer.swift`

添加：
1. 私有变量：`_dedaoAuthService`、`_dedaoAPIService`
2. 计算属性：`dedaoAuthService`、`dedaoAPIService`
3. 注册方法：`register(dedaoAuthService:)` 等

> **参考**: 搜索 `weReadAuthService` 查看添加位置

### 7.2 添加到 Xcode 项目

确保所有新文件都添加到 Xcode 项目的正确 target 中。

### Checklist - 第七阶段

- [ ] 在 `DIContainer.swift` 中添加服务注册
- [ ] 确保所有新文件添加到 Xcode 项目
- [ ] 验证依赖注入正确配置

---

## 第八阶段：测试与验证

### 功能测试清单

- [ ] 扫码登录功能正常
- [ ] 电子书列表正确加载
- [ ] 笔记数据正确获取（只显示自己的笔记，`isFromMe == 1`）
- [ ] 同步到 Notion 成功
- [ ] 增量同步正确工作
- [ ] 自动同步正确触发
- [ ] 错误处理正确显示
- [ ] Session 过期正确提示并导航
- [ ] 496 验证码错误正确提示

### 构建验证

```bash
xcodebuild -scheme SyncNos -configuration Debug build 2>&1 | grep -E "error:|warning:"
```

---

## 完整文件清单

### 新建文件 (13 个)

| 路径 | 必需 | 说明 |
|------|------|------|
| `Models/DedaoModels.swift` | ✅ | API 响应模型 |
| `Models/DedaoCacheModels.swift` | ✅ | **SwiftData 本地存储模型** |
| `Services/DataSources-From/Dedao/DedaoAuthService.swift` | ✅ | 认证服务 |
| `Services/DataSources-From/Dedao/DedaoAPIService.swift` | ✅ | API 服务 |
| `Services/DataSources-From/Dedao/DedaoCacheService.swift` | ✅ | **本地存储服务** |
| `Services/DataSources-To/Notion/SyncEngine/Adapters/DedaoNotionAdapter.swift` | ✅ | 同步适配器 |
| `ViewModels/Dedao/DedaoViewModel.swift` | ✅ | 列表 ViewModel |
| `ViewModels/Dedao/DedaoSettingsViewModel.swift` | ✅ | 设置 ViewModel |
| `Views/Dedao/DedaoListView.swift` | ✅ | 列表视图 |
| `Views/Settting/SyncFrom/DedaoSettingsView.swift` | ✅ | 设置视图 |
| `Views/Settting/SyncFrom/DedaoLoginView.swift` | ✅ | 登录视图 |
| `Services/SyncScheduling/DedaoAutoSyncProvider.swift` | ✅ | 自动同步 |

### 修改文件 (10 个)

| 路径 | 修改内容 |
|------|----------|
| `Models/SyncQueueModels.swift` | 添加 `SyncSource.dedao` |
| `Models/Models.swift` | 添加 `ContentSource.dedao` |
| `Models/HighlightColorScheme.swift` | 添加颜色映射 |
| `Models/UnifiedHighlight.swift` | 添加转换初始化器 |
| `Services/Core/Protocols.swift` | 添加协议和 `triggerDedaoNow()` |
| `Services/Core/DIContainer.swift` | 添加服务注册 |
| `Services/SyncScheduling/AutoSyncService.swift` | 添加 provider |
| `Views/Components/MainListView.swift` | 添加数据源开关和视图 |
| `Views/Settting/General/SettingsView.swift` | 添加设置入口 |
| `SyncNosApp.swift` | 添加自动同步检查 |

### 本地化文件 (16 种语言)

需要在 `Localizable.strings` 中添加：

| Key | 中文 | 英文 |
|-----|------|------|
| `source.dedao` | 得到 | Dedao |
| `dedao.settings.title` | 得到设置 | Dedao Settings |
| `dedao.login.title` | 登录得到账号 | Login to Dedao |
| `dedao.login.scanQR` | 扫码登录 | Scan QR to Login |
| `dedao.login.instruction` | 使用得到 App 扫描二维码登录 | Scan the QR code with Dedao App |
| `dedao.error.sessionExpired` | 登录已过期，请重新登录 | Session expired, please login again |
| `dedao.error.needVerification` | 需要进行图形验证码验证，请在网页版登录 | Captcha verification required, please login via web |

---

## 得到特有注意事项

### 1. 反爬虫机制

得到有严格的反爬虫保护：

| 机制 | 说明 | 处理方式 |
|------|------|----------|
| 令牌桶限流 | 5 个令牌，0.5/秒恢复 | `DedaoRateLimiter` Actor |
| 冷却期 | 检测 403/429 后 60 秒冷却 | 自动等待后重试 |
| 图形验证码 | 496 错误 | 提示用户在网页版验证 |

### 2. Cookie 管理

需要保存的 Cookie：
- `GAT` - 全局访问令牌
- `ISID` - 会话 ID
- `token` - 用户令牌
- `csrfToken` - CSRF 令牌（需要在请求头中使用）
- `_guard_device_id` - 设备 ID
- `_sid` - 会话 ID
- `acw_tc`, `aliyungf_tc` - 阿里云防护

### 3. CSRF Token

部分 API 需要在请求头中携带：

```http
Xi-Csrf-Token: <csrfToken>
Xi-DT: web
```

### 4. 笔记过滤

电子书笔记 API 返回所有笔记，需要过滤只保留自己的：

```swift
let myNotes = notes.filter { $0.isFromMe == 1 }
```

### 5. 扫码登录流程

```
1. POST /loginapi/getAccessToken → accessToken
2. GET /oauth/api/embedded/qrcode (带 X-Oauth-Access-Token) → 二维码
3. 轮询 POST /oauth/api/embedded/qrcode/check_login → 登录状态
4. 登录成功后提取 Cookie
```

---

## 快速参考

### UserDefaults Keys

| Key | 用途 |
|-----|------|
| `datasource.dedao.enabled` | 数据源启用开关 |
| `autoSync.dedao` | 自动同步启用开关 |

### Notification Names

| Name | 用途 |
|------|------|
| `DedaoLoginSucceeded` | 登录成功 |
| `NavigateToDedaoSettings` | 导航到设置页 |
| `DedaoSettingsShowLoginSheet` | 显示登录 Sheet |

### Keychain Keys

| Key | 用途 |
|-----|------|
| `dedao.cookie` | 存储认证 Cookie |
| `dedao.csrfToken` | 存储 CSRF Token |

---

## 常见问题 (FAQ)

### Q1: 为什么不实现课程笔记？

得到 API `/pc/ledgers/notes/article_comment_list` 返回的是**文章公开评论**（热门留言），不是用户自己的私有笔记。只有电子书笔记 API 支持获取用户自己的划线和备注。

### Q2: 为什么不实现电子书原文？

电子书原文通过 `/ebk_web_go/v2/get_pages` 获取，返回的 `svg` 字段是 **AES 加密的 Base64 字符串**，需要解密：

```go
key := []byte("3e4r06tjkpjcevlbslr3d96gdb5ahbmo")
iv := []byte("6fd89a1b3a7f48fb")
// AES-CBC 解密
```

实现复杂度高，且不是核心需求。

### Q3: 如何处理 496 验证码错误？

496 表示需要图形验证码验证。处理方式：
1. 捕获 496 错误
2. 显示提示："需要进行图形验证码验证，请在得到网页版登录后重试"
3. 提供打开网页版的按钮

### Q4: 如何处理 Session 过期？

参考 WeRead 的处理方式：
1. API 服务检测 401 错误 → 抛出 `DedaoAPIError.sessionExpired`
2. ViewModel 捕获 → 设置 `showRefreshFailedAlert = true`
3. View 显示 Alert → 提供"重新登录"按钮
4. 通过 NotificationCenter 导航到设置页打开登录 Sheet

---

## 预估工期

| 阶段 | 工期 | 说明 |
|------|------|------|
| 第一阶段：数据模型 | 1.5 天 | **含 SwiftData 本地存储模型** |
| 第二阶段：数据读取服务 | 2.5 天 | 含速率限制器 + **本地存储服务** |
| 第三阶段：同步适配器 | 1 天 | |
| 第四阶段：ViewModel | 1 天 | |
| 第五阶段：Views | 2 天 | 包含扫码登录 WebView |
| 第六阶段：自动同步 | 1 天 | |
| 第七阶段：配置与注册 | 0.5 天 | |
| 第八阶段：测试与验证 | 1.5 天 | |
| **总计** | **11 天** | |

---

## 未来改进（低优先级）

以下是可以在未来迭代中考虑的改进项：

### 1. 统一命名风格

当前 WeRead 使用 "Cache" 命名，Dedao 也保持一致。未来可以考虑统一重命名为更语义化的 "LocalStorage"：

| 当前命名 | 建议命名 |
|---------|---------|
| `WeReadCacheModels.swift` | `WeReadLocalModels.swift` |
| `WeReadCacheService.swift` | `WeReadLocalStorageService.swift` |
| `CachedWeReadBook` | `LocalWeReadBook` |
| `CachedWeReadHighlight` | `LocalWeReadHighlight` |
| `DedaoCacheModels.swift` | `DedaoLocalModels.swift` |
| `DedaoCacheService.swift` | `DedaoLocalStorageService.swift` |
| `CachedDedaoBook` | `LocalDedaoBook` |
| `CachedDedaoHighlight` | `LocalDedaoHighlight` |

### 2. 得到课程笔记 API

得到 API 目前只支持**电子书笔记**。未来如果得到开放**课程笔记** API（用户私有笔记，而非公开评论），可以考虑添加支持。

### 3. 电子书原文同步

需要实现 AES 解密 SVG 内容，复杂度较高。如有需求，可在未来版本添加。

---

*文档版本: 2.1*
*创建日期: 2025-12-02*
*更新日期: 2025-12-02*
*基于: ADD_NEW_DATASOURCE_CHECKLIST.md v2.0*
*更新: 添加 SwiftData 本地存储功能*
