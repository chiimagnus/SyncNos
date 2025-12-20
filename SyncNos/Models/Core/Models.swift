import Foundation
import SwiftUI

// MARK: - Types

// 当前列表/详情展示的数据来源
enum ContentSource: String, Codable, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"
    case weRead = "weRead"
    case dedao = "dedao"
    case wechatChat = "wechatChat"

    var title: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        case .dedao: return "Dedao"
        case .wechatChat: return "微信聊天"
        }
    }
    
    /// 数据源图标 (SF Symbol)
    var icon: String {
        switch self {
        case .appleBooks: return "book"
        case .goodLinks: return "bookmark"
        case .weRead: return "w.square"
        case .dedao: return "d.square"
        case .wechatChat: return "message.fill"
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
        case .wechatChat: return Color.green
        }
    }
    
    /// UserDefaults 启用状态键
    var enabledKey: String {
        "datasource.\(rawValue).enabled"
    }
    
    // MARK: - Custom Order
    
    /// UserDefaults 键：数据源自定义顺序
    static let orderKey = "datasource.customOrder"
    
    /// 数据源顺序变化通知
    static let orderChangedNotification = Notification.Name("ContentSourceOrderChanged")
    
    /// 获取用户自定义的数据源顺序（如果没有自定义，返回默认顺序）
    static var customOrder: [ContentSource] {
        get {
            guard let data = UserDefaults.standard.data(forKey: orderKey),
                  let rawValues = try? JSONDecoder().decode([String].self, from: data) else {
                return ContentSource.allCases.map { $0 }
            }
            // 从存储的 rawValue 数组恢复 ContentSource 数组
            let stored = rawValues.compactMap { ContentSource(rawValue: $0) }
            // 确保所有数据源都包含在内（处理新增数据源的情况）
            let missing = ContentSource.allCases.filter { !stored.contains($0) }
            return stored + missing
        }
        set {
            let rawValues = newValue.map { $0.rawValue }
            if let data = try? JSONEncoder().encode(rawValues) {
                UserDefaults.standard.set(data, forKey: orderKey)
                // 发送通知，通知其他组件顺序已变化
                NotificationCenter.default.post(name: orderChangedNotification, object: nil)
            }
        }
    }
    
    /// 按自定义顺序过滤已启用的数据源
    static func orderedEnabledSources(isEnabled: (ContentSource) -> Bool) -> [ContentSource] {
        customOrder.filter { isEnabled($0) }
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
