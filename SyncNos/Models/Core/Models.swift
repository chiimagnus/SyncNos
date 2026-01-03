import Foundation
import SwiftUI

// MARK: - Types

// 当前列表/详情展示的数据来源
enum ContentSource: String, Codable, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"
    case weRead = "weRead"
    case dedao = "dedao"
    case chats = "chats"

    var title: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        case .dedao: return "Dedao"
        case .chats: return "Chats"
        }
    }
    
    /// 数据源图标 (SF Symbol)
    var icon: String {
        switch self {
        case .appleBooks: return "book"
        case .goodLinks: return "bookmark"
        case .weRead: return "w.square"
        case .dedao: return "d.square"
        case .chats: return "message"
        }
    }
    
    /// 数据源显示名称
    var displayName: String {
        title
    }
    
    /// 数据源强调色
    var accentColor: Color {
        switch self {
        case .appleBooks: return Color("BrandAppleBooks")
        case .goodLinks: return Color("BrandGoodLinks")
        case .weRead: return Color("BrandWeRead")
        case .dedao: return Color("BrandDedao")
        case .chats: return Color.green
        }
    }
    
    /// 品牌颜色背景透明度（用于 SyncQueueView 等）
    var brandBackgroundOpacity: Double {
        switch self {
        case .appleBooks: return 0.18
        case .goodLinks: return 0.12
        case .weRead: return 0.14
        case .dedao: return 0.14
        case .chats: return 0.14
        }
    }
    
    /// SF Symbol 图标名称（别名，与 icon 相同）
    var iconName: String { icon }
    
    /// 品牌颜色（别名，与 accentColor 相同）
    var brandColor: Color { accentColor }
    
    /// UserDefaults 启用状态键
    var enabledKey: String {
        "datasource.\(rawValue).enabled"
    }
    
    /// 同步记录存储键（用于 SyncedHighlightStore）
    /// 与 rawValue 相同，提供语义化访问
    var sourceKey: String { rawValue }
    
    // MARK: - Custom Order
    
    /// UserDefaults 键：数据源自定义顺序（V2：String 存储，不向后兼容旧 Data(JSON)）
    static let orderKey = "datasource.customOrder.v2"
    
    /// 旧版本顺序 key（Data(JSON)），V2 不读取；写入 V2 时会清理
    static let legacyOrderKey = "datasource.customOrder"
    
    /// 获取用户自定义的数据源顺序（如果没有自定义，返回默认顺序）
    static var customOrder: [ContentSource] {
        get {
            let raw = UserDefaults.standard.string(forKey: orderKey) ?? ""
            return ContentSourceOrder(rawValue: raw).sources
        }
        set {
            let raw = ContentSourceOrder.encode(newValue).rawValue
            UserDefaults.standard.set(raw, forKey: orderKey)
            // 破坏性：不做迁移，写入 V2 时清理旧 key（避免后续困惑）
            UserDefaults.standard.removeObject(forKey: legacyOrderKey)
        }
    }
    
    /// 默认顺序（用于首次启动/未设置时回退）
    static var defaultOrder: [ContentSource] {
        ContentSource.allCases
    }
    
    /// 将输入顺序规范化：去重、并补齐缺失的数据源
    static func normalizedOrder(_ order: [ContentSource]) -> [ContentSource] {
        var seen = Set<ContentSource>()
        var result: [ContentSource] = []
        result.reserveCapacity(ContentSource.allCases.count)
        
        for s in order where seen.insert(s).inserted {
            result.append(s)
        }
        
        for s in ContentSource.allCases where !seen.contains(s) {
            result.append(s)
        }
        
        return result
    }
    
    /// 按自定义顺序过滤已启用的数据源
    static func orderedEnabledSources(isEnabled: (ContentSource) -> Bool) -> [ContentSource] {
        customOrder.filter { isEnabled($0) }
    }
}

/// 存储 ContentSource 顺序的可持久化类型（V2：String）
/// - 不向后兼容旧 Data(JSON) 格式：旧值将被忽略并回退到默认顺序
struct ContentSourceOrder: RawRepresentable, Equatable, Sendable {
    let rawValue: String
    
    init(rawValue: String) {
        self.rawValue = rawValue
    }
    
    /// 从 rawValue 解析并规范化后的顺序
    var sources: [ContentSource] {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return ContentSource.defaultOrder }
        
        let parts = trimmed.split(separator: ",")
        var parsed: [ContentSource] = []
        parsed.reserveCapacity(parts.count)
        
        for p in parts {
            let token = p.trimmingCharacters(in: .whitespacesAndNewlines)
            if let s = ContentSource(rawValue: token) {
                parsed.append(s)
            }
        }
        
        guard !parsed.isEmpty else { return ContentSource.defaultOrder }
        return ContentSource.normalizedOrder(parsed)
    }
    
    static var `default`: ContentSourceOrder {
        ContentSourceOrder.encode(ContentSource.defaultOrder)
    }
    
    static func encode(_ sources: [ContentSource]) -> ContentSourceOrder {
        let normalized = ContentSource.normalizedOrder(sources)
        let raw = normalized.map { $0.rawValue }.joined(separator: ",")
        return ContentSourceOrder(rawValue: raw)
    }
}

struct Highlight: Codable {
    let uuid: String
    let text: String
    let note: String?
    let style: Int?
    let dateAdded: Date?
    let modified: Date?
    let location: String?
}

struct HighlightRow { 
    let assetId: String
    let uuid: String
    let text: String 
    let note: String?
    let style: Int?
    let dateAdded: Date?
    let modified: Date?
    let location: String?
}

struct BookRow { 
    let assetId: String
    let author: String
    let title: String 
}

struct Filters { 
    let bookSubstrings: [String]
    let authorSubstrings: [String]
    let assetIds: [String] 
}

// Lightweight model for listing books without loading all highlights
struct BookListItem: Codable, Equatable {
    let bookId: String
    let authorName: String
    let bookTitle: String
    let ibooksURL: String
    let highlightCount: Int

    // Optional metadata for sorting and filtering
    let createdAt: Date?
    let modifiedAt: Date?
    let hasTitle: Bool

    // Default initializer to maintain backward compatibility
    init(bookId: String, authorName: String, bookTitle: String, ibooksURL: String, highlightCount: Int) {
        self.bookId = bookId
        self.authorName = authorName
        self.bookTitle = bookTitle
        self.ibooksURL = ibooksURL
        self.highlightCount = highlightCount
        self.createdAt = nil
        self.modifiedAt = nil
        self.hasTitle = !bookTitle.isEmpty
    }

    // Initializer with metadata
    init(bookId: String, authorName: String, bookTitle: String, ibooksURL: String, highlightCount: Int, createdAt: Date?, modifiedAt: Date?, hasTitle: Bool) {
        self.bookId = bookId
        self.authorName = authorName
        self.bookTitle = bookTitle
        self.ibooksURL = ibooksURL
        self.highlightCount = highlightCount
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.hasTitle = hasTitle
    }
}

// Aggregated highlight count per asset/book
struct AssetHighlightCount {
    let assetId: String
    let count: Int
}

// MARK: - Filtering and Sorting Models

struct AssetHighlightStats {
    let assetId: String
    let count: Int
    let minCreationDate: Date?
    let maxModifiedDate: Date?
}

enum BookListSortKey: String, CaseIterable {
    case title = "title"
    case highlightCount = "highlightCount"
    case created = "created"
    case lastEdited = "lastEdited"
    case lastSync = "lastSync"

    var displayName: LocalizedStringResource {
        switch self {
        case .title: return "Title"
        case .highlightCount: return "Highlight Count"
        case .lastSync: return "Last Sync Time"
        case .lastEdited: return "Modified Time"
        case .created: return "Added Time"
        }
    }
}

// Note filter: true = show only highlights with notes, false = show all
typealias NoteFilter = Bool

// 新的高亮排序模型：由排序字段和方向组合，替代旧的 HighlightOrder
enum HighlightSortField: String, CaseIterable {
    case created = "created"
    case modified = "modified"

    var displayName: LocalizedStringResource {
        switch self {
        case .created: return "Added Time"
        case .modified: return "Modified Time"
        }
    }
}
