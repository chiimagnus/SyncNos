import Foundation
import SwiftData

// MARK: - SwiftData Models

@Model
final class WeReadBook {
    /// 微信读书书籍 ID（唯一）
    @Attribute(.unique) var bookId: String
    var title: String
    var author: String
    var coverUrl: String?
    var category: String?

    /// 来自 WeRead 的时间信息（可选）
    var createdAt: Date?
    var updatedAt: Date?

    /// 最近一次同步到 Notion 的时间（冗余字段，便于 SwiftData 查询）
    var lastSyncAt: Date?

    /// 与该书关联的所有高亮
    @Relationship(deleteRule: .cascade, inverse: \WeReadHighlight.book)
    var highlights: [WeReadHighlight] = []

    init(
        bookId: String,
        title: String,
        author: String,
        coverUrl: String? = nil,
        category: String? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil,
        lastSyncAt: Date? = nil
    ) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.coverUrl = coverUrl
        self.category = category
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastSyncAt = lastSyncAt
    }
}

@Model
final class WeReadHighlight {
    /// WeRead 高亮 ID（唯一）
    @Attribute(.unique) var highlightId: String

    /// 所属书籍
    var book: WeReadBook?

    var text: String
    var note: String?
    var colorIndex: Int?

    var createdAt: Date?
    var modifiedAt: Date?

    var chapterTitle: String?
    var location: String?

    /// 远端内容指纹，用于和 Notion 现有内容比对是否需要更新
    var remoteHash: String?

    init(
        highlightId: String,
        book: WeReadBook?,
        text: String,
        note: String? = nil,
        colorIndex: Int? = nil,
        createdAt: Date? = nil,
        modifiedAt: Date? = nil,
        chapterTitle: String? = nil,
        location: String? = nil,
        remoteHash: String? = nil
    ) {
        self.highlightId = highlightId
        self.book = book
        self.text = text
        self.note = note
        self.colorIndex = colorIndex
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.chapterTitle = chapterTitle
        self.location = location
        self.remoteHash = remoteHash
    }
}

// MARK: - UI 列表模型

/// WeRead 书籍在列表中的轻量视图模型，避免在 UI 层直接依赖 SwiftData 对象
struct WeReadBookListItem: Identifiable, Equatable {
    var id: String { bookId }

    let bookId: String
    let title: String
    let author: String
    let highlightCount: Int
    let createdAt: Date?
    let updatedAt: Date?
    let lastSyncAt: Date?

    init(
        bookId: String,
        title: String,
        author: String,
        highlightCount: Int,
        createdAt: Date?,
        updatedAt: Date?,
        lastSyncAt: Date?
    ) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.highlightCount = highlightCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastSyncAt = lastSyncAt
    }

    init(from model: WeReadBook) {
        self.bookId = model.bookId
        self.title = model.title
        self.author = model.author
        self.highlightCount = model.highlights.count
        self.createdAt = model.createdAt
        self.updatedAt = model.updatedAt
        self.lastSyncAt = model.lastSyncAt
    }
}

// MARK: - WeRead API DTO 模型

/// 用户 Notebook 条目（每本书/文章的基本信息）
struct WeReadNotebook: Decodable {
    let bookId: String
    let title: String
    let author: String?
    let cover: String?
    let category: String?

    // 服务器返回的时间戳（秒或毫秒），此处不强依赖其存在
    let createdTimestamp: TimeInterval?
    let updatedTimestamp: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case bookId
        case title
        case author
        case cover
        case category
        case createdTimestamp = "created"
        case updatedTimestamp = "updated"
    }
}

/// 书籍详细信息
struct WeReadBookInfo: Decodable {
    let bookId: String
    let title: String
    let author: String?
    let cover: String?
    let category: String?

    enum CodingKeys: String, CodingKey {
        case bookId
        case title
        case author
        case cover
        case category
    }
}

/// 单条高亮
struct WeReadBookmark: Decodable {
    let highlightId: String
    let bookId: String
    let chapterTitle: String?
    let colorIndex: Int?
    let text: String
    let note: String?
    let timestamp: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case highlightId = "bookmarkId"
        case bookId
        case chapterTitle = "chapterTitle"
        case colorIndex = "color"
        case text = "content"
        case note
        case timestamp = "createTime"
    }
}

/// 单条想法 / 书评
struct WeReadReview: Decodable {
    let reviewId: String
    let bookId: String
    let content: String
    let timestamp: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case reviewId = "reviewId"
        case bookId
        case content
        case timestamp = "createTime"
    }
}


