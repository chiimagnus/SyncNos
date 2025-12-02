import Foundation
import SwiftData

// MARK: - Cached Dedao Book

/// 本地存储的得到电子书元数据
@Model
final class CachedDedaoBook {
    /// 书籍唯一标识（enid）
    @Attribute(.unique) var bookId: String
    
    /// 书籍标题
    var title: String
    
    /// 作者
    var author: String
    
    /// 封面图片 URL
    var cover: String?
    
    /// 高亮数量
    var highlightCount: Int
    
    /// 最后一次从 API 获取数据的时间
    var lastFetchedAt: Date?
    
    // MARK: - 关系
    
    /// 关联的高亮列表
    @Relationship(deleteRule: .cascade, inverse: \CachedDedaoHighlight.book)
    var highlights: [CachedDedaoHighlight]?
    
    // MARK: - 初始化
    
    init(
        bookId: String,
        title: String,
        author: String,
        cover: String? = nil,
        highlightCount: Int = 0
    ) {
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
    /// 高亮唯一标识（noteIdStr）
    @Attribute(.unique) var highlightId: String
    
    /// 所属书籍 ID（bookId/enid）
    var bookId: String
    
    /// 划线文本内容（noteLine）
    var text: String
    
    /// 用户备注（note）
    var note: String?
    
    /// 章节标题（extra.title）
    var chapterTitle: String?
    
    /// 章节标识（extra.bookSection）
    var bookSection: String?
    
    /// 创建时间
    var createdAt: Date?
    
    /// 更新时间
    var updatedAt: Date?
    
    // MARK: - 关系
    
    /// 所属书籍
    var book: CachedDedaoBook?
    
    // MARK: - 初始化
    
    init(
        highlightId: String,
        bookId: String,
        text: String,
        note: String? = nil,
        chapterTitle: String? = nil,
        bookSection: String? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.highlightId = highlightId
        self.bookId = bookId
        self.text = text
        self.note = note
        self.chapterTitle = chapterTitle
        self.bookSection = bookSection
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// 从 API DTO 创建本地存储模型
    convenience init(from apiNote: DedaoEbookNote) {
        self.init(
            highlightId: apiNote.noteIdStr,
            bookId: apiNote.extra.bookName,
            text: apiNote.noteLine,
            note: apiNote.note.isEmpty ? nil : apiNote.note,
            chapterTitle: apiNote.extra.title,
            bookSection: apiNote.extra.bookSection,
            createdAt: Date(timeIntervalSince1970: TimeInterval(apiNote.createTime)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(apiNote.updateTime))
        )
    }
}

// MARK: - Dedao Sync State

/// 全局同步状态
@Model
final class DedaoSyncState {
    /// 唯一标识（固定为 "global"）
    @Attribute(.unique) var id: String
    
    /// 最后一次全量同步时间
    var lastFullSyncAt: Date?
    
    /// 最后一次增量同步时间
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

extension UnifiedHighlight {
    /// 从本地存储的得到笔记创建
    init(from cached: CachedDedaoHighlight) {
        self.init(
            uuid: cached.highlightId,
            text: cached.text,
            note: cached.note,
            colorIndex: 0,  // 得到不提供颜色信息
            dateAdded: cached.createdAt,
            dateModified: cached.updatedAt,
            location: cached.chapterTitle,
            source: .dedao
        )
    }
}

