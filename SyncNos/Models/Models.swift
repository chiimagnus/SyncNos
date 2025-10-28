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

    var displayName: LocalizedStringResource {
        switch self {
        case .title: return "Title"
        case .highlightCount: return "Note Count"
        case .lastSync: return "Sync Time"
        case .lastEdited: return "Edit Time"
        case .created: return "Creation Time"
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
        case .created: return "Creation Time"
        case .modified: return "Modified Time"
        }
    }
}

// Global highlight sort key for menu commands
enum HighlightSortKey: String, CaseIterable {
    case created = "created"
    case modified = "modified"

    var displayName: LocalizedStringResource {
        switch self {
        case .created: return "Create Time"
        case .modified: return "Modified Time"
        }
    }
}

