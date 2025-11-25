import Foundation
import SwiftData

// MARK: - Cached WeRead Book

/// 缓存的微信读书书籍元数据
@Model
final class CachedWeReadBook {
    /// 书籍唯一标识
    @Attribute(.unique) var bookId: String
    
    /// 书籍标题
    var title: String
    
    /// 作者
    var author: String
    
    /// 封面图片 URL
    var cover: String?
    
    /// 分类
    var category: String?
    
    /// 高亮数量
    var highlightCount: Int
    
    /// 笔记/想法数量
    var reviewCount: Int
    
    /// 书籍创建时间（在 WeRead 中）
    var createdAt: Date?
    
    /// 书籍更新时间（在 WeRead 中）
    var updatedAt: Date?
    
    // MARK: - 同步元数据
    
    /// 最后一次从 API 获取数据的时间
    var lastFetchedAt: Date?
    
    /// 该书高亮的 synckey（用于增量同步）
    var bookmarksSyncKey: Int?
    
    // MARK: - 关系
    
    /// 关联的高亮列表
    @Relationship(deleteRule: .cascade, inverse: \CachedWeReadHighlight.book)
    var highlights: [CachedWeReadHighlight]?
    
    // MARK: - 初始化
    
    init(
        bookId: String,
        title: String,
        author: String,
        cover: String? = nil,
        category: String? = nil,
        highlightCount: Int = 0,
        reviewCount: Int = 0,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.cover = cover
        self.category = category
        self.highlightCount = highlightCount
        self.reviewCount = reviewCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// 从 API DTO 创建缓存模型
    convenience init(from notebook: WeReadNotebook) {
        self.init(
            bookId: notebook.bookId,
            title: notebook.title,
            author: notebook.author ?? "",
            cover: notebook.cover,
            category: notebook.category,
            createdAt: notebook.createdTimestamp.map { Date(timeIntervalSince1970: $0) },
            updatedAt: notebook.updatedTimestamp.map { Date(timeIntervalSince1970: $0) }
        )
    }
}

// MARK: - Cached WeRead Highlight

/// 缓存的微信读书高亮/笔记
@Model
final class CachedWeReadHighlight {
    /// 高亮唯一标识
    @Attribute(.unique) var highlightId: String
    
    /// 所属书籍 ID
    var bookId: String
    
    /// 高亮文本内容
    var text: String
    
    /// 简短笔记
    var note: String?
    
    /// 章节标题
    var chapterTitle: String?
    
    /// 颜色索引（0-4）
    var colorIndex: Int?
    
    /// 创建时间
    var createdAt: Date?
    
    /// 范围标识（用于匹配想法）
    var range: String?
    
    /// 关联的想法内容（JSON 编码的字符串数组）
    var reviewContentsJSON: String?
    
    // MARK: - 关系
    
    /// 所属书籍
    var book: CachedWeReadBook?
    
    // MARK: - 计算属性
    
    /// 关联的想法内容数组
    var reviewContents: [String] {
        get {
            guard let json = reviewContentsJSON,
                  let data = json.data(using: .utf8),
                  let array = try? JSONDecoder().decode([String].self, from: data) else {
                return []
            }
            return array
        }
        set {
            if newValue.isEmpty {
                reviewContentsJSON = nil
            } else if let data = try? JSONEncoder().encode(newValue),
                      let json = String(data: data, encoding: .utf8) {
                reviewContentsJSON = json
            }
        }
    }
    
    // MARK: - 初始化
    
    init(
        highlightId: String,
        bookId: String,
        text: String,
        note: String? = nil,
        chapterTitle: String? = nil,
        colorIndex: Int? = nil,
        createdAt: Date? = nil,
        range: String? = nil,
        reviewContents: [String] = []
    ) {
        self.highlightId = highlightId
        self.bookId = bookId
        self.text = text
        self.note = note
        self.chapterTitle = chapterTitle
        self.colorIndex = colorIndex
        self.createdAt = createdAt
        self.range = range
        
        // 设置 reviewContents
        if !reviewContents.isEmpty,
           let data = try? JSONEncoder().encode(reviewContents),
           let json = String(data: data, encoding: .utf8) {
            self.reviewContentsJSON = json
        }
    }
    
    /// 从 API DTO 创建缓存模型
    convenience init(from bookmark: WeReadBookmark) {
        self.init(
            highlightId: bookmark.highlightId,
            bookId: bookmark.bookId,
            text: bookmark.text,
            note: bookmark.note,
            chapterTitle: bookmark.chapterTitle,
            colorIndex: bookmark.colorIndex,
            createdAt: bookmark.timestamp.map { Date(timeIntervalSince1970: $0) },
            range: bookmark.range,
            reviewContents: bookmark.reviewContents
        )
    }
}

// MARK: - WeRead Sync State

/// 全局同步状态
@Model
final class WeReadSyncState {
    /// 唯一标识（固定为 "global"）
    @Attribute(.unique) var id: String
    
    /// Notebook 列表的 synckey
    var notebookSyncKey: Int?
    
    /// 最后一次全量同步时间
    var lastFullSyncAt: Date?
    
    /// 最后一次增量同步时间
    var lastIncrementalSyncAt: Date?
    
    init() {
        self.id = "global"
    }
}

// MARK: - Conversion Extensions

extension WeReadBookListItem {
    /// 从缓存模型创建 UI 列表模型
    init(from cached: CachedWeReadBook) {
        self.init(
            bookId: cached.bookId,
            title: cached.title,
            author: cached.author,
            highlightCount: cached.highlightCount,
            createdAt: cached.createdAt,
            updatedAt: cached.updatedAt,
            lastSyncAt: nil
        )
    }
}

extension WeReadBookmark {
    /// 从缓存模型创建 API DTO
    init(from cached: CachedWeReadHighlight) {
        self.init(
            highlightId: cached.highlightId,
            bookId: cached.bookId,
            chapterTitle: cached.chapterTitle,
            colorIndex: cached.colorIndex,
            text: cached.text,
            note: cached.note,
            timestamp: cached.createdAt?.timeIntervalSince1970,
            reviewContents: cached.reviewContents,
            range: cached.range
        )
    }
}

