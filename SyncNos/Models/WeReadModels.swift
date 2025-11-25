import Foundation

// MARK: - UI 列表模型

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

    init(from notebook: WeReadNotebook, highlightCount: Int = 0) {
        self.bookId = notebook.bookId
        self.title = notebook.title
        self.author = notebook.author ?? ""
        self.highlightCount = highlightCount
        self.createdAt = notebook.createdTimestamp.map { Date(timeIntervalSince1970: $0) }
        self.updatedAt = notebook.updatedTimestamp.map { Date(timeIntervalSince1970: $0) }
        self.lastSyncAt = nil
    }
}

// MARK: - WeRead API DTO 模型

/// 用户 Notebook 条目（每本书/文章的基本信息）对应 `/api/user/notebook` 中的 `books` 列表元素
///
/// 实际返回结构示例：
/// {
///   "bookId": "34389621",
///   "book": {
///     "bookId": "34389621",
///     "title": "...",
///     "author": "...",
///     "cover": "https://...",
///     "category": "..."
///   },
///   "created": 1680000000,
///   "updated": 1690000000,
///   ...
/// }
struct WeReadNotebook: Decodable {
    let bookId: String
    let title: String
    let author: String?
    let cover: String?
    let category: String?

    // 服务器返回的时间戳（秒或毫秒），此处不强依赖其存在
    let createdTimestamp: TimeInterval?
    let updatedTimestamp: TimeInterval?

    private enum CodingKeys: String, CodingKey {
        case bookId
        case book
        case title
        case author
        case cover
        case category
        case created = "created"
        case updated = "updated"
    }

    private enum BookKeys: String, CodingKey {
        case bookId
        case title
        case author
        case cover
        case category
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // 优先从嵌套的 book 对象中取书籍信息，兼容旧结构直接在顶层返回 title/author 等字段
        if let bookContainer = try? container.nestedContainer(keyedBy: BookKeys.self, forKey: .book) {
            let nestedBookId = try? bookContainer.decode(String.self, forKey: .bookId)
            let topLevelBookId = try? container.decode(String.self, forKey: .bookId)
            self.bookId = nestedBookId ?? topLevelBookId ?? ""

            if let nestedTitle = try? bookContainer.decode(String.self, forKey: .title) {
                self.title = nestedTitle
            } else {
                self.title = (try? container.decode(String.self, forKey: .title)) ?? ""
            }

            self.author = (try? bookContainer.decode(String.self, forKey: .author))
                ?? (try? container.decode(String.self, forKey: .author))
            self.cover = (try? bookContainer.decode(String.self, forKey: .cover))
                ?? (try? container.decode(String.self, forKey: .cover))
            self.category = (try? bookContainer.decode(String.self, forKey: .category))
                ?? (try? container.decode(String.self, forKey: .category))
        } else {
            // 兼容没有嵌套 book 的情况
            self.bookId = (try? container.decode(String.self, forKey: .bookId)) ?? ""
            self.title = try container.decode(String.self, forKey: .title)
            self.author = try? container.decode(String.self, forKey: .author)
            self.cover = try? container.decode(String.self, forKey: .cover)
            self.category = try? container.decode(String.self, forKey: .category)
        }

        self.createdTimestamp = try? container.decode(TimeInterval.self, forKey: .created)
        self.updatedTimestamp = try? container.decode(TimeInterval.self, forKey: .updated)
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

/// 单条高亮（Swift 内部使用的归一化结构）
///
/// 注意：WeRead 后端返回的是 HighlightResponse（见 `WeReadHighlightResponse`），
/// 其中真正的高亮在 `updated` 数组中，本结构由 `WeReadAPIService.decodeBookmarks` 手动组装。
struct WeReadBookmark {
    let highlightId: String
    let bookId: String
    let chapterTitle: String?
    let colorIndex: Int?
    let text: String
    let note: String?
    let timestamp: TimeInterval?
    let reviewContents: [String]  // 关联的多条想法内容（一条高亮可以有多条注释）
    let range: String?            // 用于匹配想法的范围标识
}

/// 单条想法 / 书评
///
/// 实际 JSON 结构示例（来自 `/web/review/list`）：
/// {
///   "reviewId": "422219929_84NvtpVKU",
///   "review": {
///     "type": 1,
///     "bookId": "34389621",
///     "chapterUid": 303,
///     "content": "这是一个测试啊啊啊啊",
///     "createTime": 1763619349,
///     "range": "123-456",
///     ...
///   }
/// }
struct WeReadReview: Decodable {
    let reviewId: String
    let bookId: String
    let content: String
    let timestamp: TimeInterval?
    let range: String?      // 用于匹配高亮的范围标识
    let type: Int           // 1=章节想法, 4=书评

    private enum CodingKeys: String, CodingKey {
        case reviewId
        case review
        // 兼容可能扁平化在顶层的字段
        case bookId
        case content
        case createTime
        case range
        case type
    }

    private enum ReviewDetailKeys: String, CodingKey {
        case bookId
        case content
        case createTime
        case range
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = (try? container.decode(String.self, forKey: .reviewId)) ?? ""

        // 优先从嵌套的 review 对象中取字段
        if let reviewContainer = try? container.nestedContainer(keyedBy: ReviewDetailKeys.self, forKey: .review) {
            bookId = (try? reviewContainer.decode(String.self, forKey: .bookId))
                ?? (try? container.decode(String.self, forKey: .bookId))
                ?? ""
            content = (try? reviewContainer.decode(String.self, forKey: .content))
                ?? (try? container.decode(String.self, forKey: .content))
                ?? ""
            timestamp = (try? reviewContainer.decode(TimeInterval.self, forKey: .createTime))
                ?? (try? container.decode(TimeInterval.self, forKey: .createTime))
            range = (try? reviewContainer.decode(String.self, forKey: .range))
                ?? (try? container.decode(String.self, forKey: .range))
            type = (try? reviewContainer.decode(Int.self, forKey: .type))
                ?? (try? container.decode(Int.self, forKey: .type))
                ?? 1
        } else {
            // 退化为所有字段都在顶层的情况
            bookId = (try? container.decode(String.self, forKey: .bookId)) ?? ""
            content = (try? container.decode(String.self, forKey: .content)) ?? ""
            timestamp = try? container.decode(TimeInterval.self, forKey: .createTime)
            range = try? container.decode(String.self, forKey: .range)
            type = (try? container.decode(Int.self, forKey: .type)) ?? 1
        }
    }
}

/// WeRead `/web/book/bookmarklist` 高亮响应（对应 Obsidian 插件中的 HighlightResponse）
struct WeReadHighlightResponse: Decodable {
    struct HighlightItem: Decodable {
        let bookId: String
        let bookVersion: Int?
        let chapterName: String?
        let chapterUid: Int?
        let colorStyle: Int?
        let contextAbstract: String?
        let markText: String
        let range: String
        let style: Int?
        let type: Int?
        let createTime: TimeInterval
        let bookmarkId: String
        let refMpReviewId: String?
    }

    struct ChapterItem: Decodable {
        let bookId: String
        let chapterUid: Int?
        let chapterIdx: Int?
        let title: String
    }

    let synckey: Int?
    let updated: [HighlightItem]
    let removed: [String]?
    let chapters: [ChapterItem]?
}

// MARK: - 增量同步响应模型

/// Notebook 增量同步响应
struct NotebooksIncrementalResponse {
    let syncKey: Int
    let updated: [WeReadNotebook]
    let removed: [String]?
}

/// 高亮增量同步响应
struct BookmarksIncrementalResponse {
    let syncKey: Int
    let updated: [WeReadBookmark]
    let removed: [String]?
}
