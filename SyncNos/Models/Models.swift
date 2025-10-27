import Foundation

// MARK: - Types

// 当前列表/详情展示的数据来源
enum ContentSource: String, Codable, CaseIterable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"

    var title: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        }
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
    // Apple Books 专用的人类可读位置描述（例如：第3章 第2节 位置57 或 第12页）
    let locationDisplay: String?
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
    case lastSync = "lastSync"
    case lastEdited = "lastEdited"
    case created = "created"

    var displayName: String {
        switch self {
        case .title: return NSLocalizedString("Title", comment: "Book list sort option")
        case .highlightCount: return NSLocalizedString("Note Count", comment: "Book list sort option")
        case .lastSync: return NSLocalizedString("Sync Time", comment: "Book list sort option")
        case .lastEdited: return NSLocalizedString("Edit Time", comment: "Book list sort option")
        case .created: return NSLocalizedString("Creation Time", comment: "Book list sort option")
        }
    }
}

enum NoteFilter: String, CaseIterable {
    case any = "any"
    case hasNote = "hasNote"
    case noNote = "noNote"

    var displayName: String {
        switch self {
        case .any: return "全部"
        case .hasNote: return "仅含笔记"
        case .noNote: return "仅不含笔记"
        }
    }
}

// 新的高亮排序模型：由排序字段和方向组合，替代旧的 HighlightOrder
enum HighlightSortField: String, CaseIterable {
    case created = "created"
    case modified = "modified"
    case location = "location"

    var displayName: String {
        switch self {
        case .created: return "创建时间"
        case .modified: return "编辑时间"
        case .location: return "位置"
        }
    }
}

