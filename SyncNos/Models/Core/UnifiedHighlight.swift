import Foundation

// MARK: - Unified Highlight Model

/// 统一的高亮数据模型
/// 所有数据源（AppleBooks、GoodLinks、WeRead 等）都转换为此格式后进行同步
struct UnifiedHighlight: Identifiable, Equatable {
    var id: String { uuid }
    
    /// 高亮唯一标识符
    let uuid: String
    
    /// 高亮文本内容
    let text: String
    
    /// 用户笔记/注释
    let note: String?
    
    /// 颜色索引（不同数据源有不同的颜色映射）
    let colorIndex: Int?
    
    /// 添加时间
    let dateAdded: Date?
    
    /// 修改时间
    let dateModified: Date?
    
    /// 位置信息（章节、页码等）
    let location: String?
    
    /// 数据来源
    let source: HighlightSource
    
    // MARK: - Conversion from HighlightRow
    
    /// 从 HighlightRow 转换（Apple Books 数据源）
    init(from row: HighlightRow) {
        self.uuid = row.uuid
        self.text = row.text
        self.note = row.note
        self.colorIndex = row.style
        self.dateAdded = row.dateAdded
        self.dateModified = row.modified
        self.location = row.location
        self.source = .appleBooks
    }
    
    /// 从 GoodLinksHighlightRow 转换
    init(from row: GoodLinksHighlightRow, linkId: String) {
        self.uuid = row.id
        self.text = row.content
        self.note = row.note
        self.colorIndex = row.color
        self.dateAdded = row.time > 0 ? Date(timeIntervalSince1970: row.time) : nil
        self.dateModified = nil
        self.location = nil
        self.source = .goodLinks
    }
    
    /// 从 WeReadBookmark 转换
    init(from bookmark: WeReadBookmark) {
        self.uuid = bookmark.highlightId
        self.text = bookmark.text
        // 合并多条想法内容，用换行符分隔
        let combinedReviews = bookmark.reviewContents.isEmpty ? nil : bookmark.reviewContents.joined(separator: "\n")
        self.note = combinedReviews ?? bookmark.note
        self.colorIndex = bookmark.colorIndex
        self.dateAdded = bookmark.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.dateModified = nil
        self.location = bookmark.chapterTitle
        self.source = .weRead
    }
    
    /// 从 DedaoEbookNote 转换（得到电子书笔记）
    /// 支持标准格式和混合格式两种 API 响应
    init(from note: DedaoEbookNote) {
        self.uuid = note.effectiveId
        self.text = note.effectiveNoteLine
        // 用户备注：非空才使用
        if let noteContent = note.note, !noteContent.isEmpty {
            self.note = noteContent
        } else {
            self.note = nil
        }
        self.colorIndex = 0  // 得到不提供颜色信息，使用默认
        
        let createTs = note.effectiveCreateTime
        self.dateAdded = createTs > 0 ? Date(timeIntervalSince1970: TimeInterval(createTs)) : nil
        
        let updateTs = note.effectiveUpdateTime
        self.dateModified = updateTs > 0 ? Date(timeIntervalSince1970: TimeInterval(updateTs)) : nil
        
        self.location = note.extra?.title  // 章节标题（可选）
        self.source = .dedao
    }
    
    /// 从 ChatMessage 转换（微信聊天消息）
    /// - Parameters:
    ///   - message: 聊天消息
    ///   - contactName: 对话联系人名称（用于填充发送者信息）
    /// 
    /// **设计说明**：为实现 "Sender Name 作为主块，消息内容作为子块" 的格式，
    /// 将 sender name 存储在 `text` 字段（通用逻辑将其作为父块），
    /// 将消息内容存储在 `note` 字段（通用逻辑将其作为子块）。
    /// 这样无需修改 NotionHelperMethods，通用逻辑自动产生正确格式。
    init(from message: ChatMessage, contactName: String) {
        self.uuid = message.id.uuidString
        
        // text 存储 sender name（将作为 Notion 中的父块）
        if let senderName = message.senderName, !senderName.isEmpty {
            self.text = senderName
        } else if message.isFromMe {
            self.text = "Me"
        } else {
            self.text = contactName
        }
        
        // note 存储消息内容（将作为 Notion 中的子块）
        self.note = message.content
        
        // Chats 不需要颜色索引、时间戳等字段
        self.colorIndex = nil
        self.dateAdded = nil
        self.dateModified = nil
        self.location = nil
        self.source = .chats
    }
    
    /// 通用初始化器
    init(
        uuid: String,
        text: String,
        note: String?,
        colorIndex: Int?,
        dateAdded: Date?,
        dateModified: Date?,
        location: String?,
        source: HighlightSource
    ) {
        self.uuid = uuid
        self.text = text
        self.note = note
        self.colorIndex = colorIndex
        self.dateAdded = dateAdded
        self.dateModified = dateModified
        self.location = location
        self.source = source
    }
    
    // MARK: - Conversion to HighlightRow
    
    /// 转换为 HighlightRow（用于与现有 Notion 操作兼容）
    func toHighlightRow(assetId: String) -> HighlightRow {
        HighlightRow(
            assetId: assetId,
            uuid: uuid,
            text: text,
            note: note,
            style: colorIndex,
            dateAdded: dateAdded,
            modified: dateModified,
            location: location
        )
    }
}

// MARK: - Unified Item Model

/// 统一的书籍/文章信息模型
/// 用于同步引擎识别同步目标
struct UnifiedSyncItem: Identifiable, Equatable {
    var id: String { itemId }
    
    /// 唯一标识符（bookId、linkId 等）
    let itemId: String
    
    /// 标题
    let title: String
    
    /// 作者
    let author: String
    
    /// 原始 URL（可选，用于 GoodLinks 等）
    let url: String?
    
    /// 数据来源
    let source: HighlightSource
    
    /// 高亮数量
    let highlightCount: Int
    
    // MARK: - Conversion from source models
    
    /// 从 BookListItem 转换（Apple Books）
    init(from book: BookListItem) {
        self.itemId = book.bookId
        self.title = book.bookTitle
        self.author = book.authorName
        self.url = book.ibooksURL.isEmpty ? nil : book.ibooksURL
        self.source = .appleBooks
        self.highlightCount = book.highlightCount
    }
    
    /// 从 GoodLinksLinkRow 转换
    init(from link: GoodLinksLinkRow) {
        self.itemId = link.id
        self.title = link.title ?? link.url
        self.author = link.author ?? ""
        self.url = link.url
        self.source = .goodLinks
        self.highlightCount = link.highlightTotal ?? 0
    }
    
    /// 从 WeReadBookListItem 转换
    init(from book: WeReadBookListItem) {
        self.itemId = book.bookId
        self.title = book.title
        self.author = book.author
        self.url = nil
        self.source = .weRead
        self.highlightCount = book.highlightCount
    }
    
    /// 从 DedaoBookListItem 转换（得到电子书）
    init(from book: DedaoBookListItem) {
        self.itemId = book.bookId
        self.title = book.title
        self.author = book.author
        self.url = nil
        self.source = .dedao
        self.highlightCount = book.highlightCount
    }
    
    /// 从 ChatBookListItem 转换（微信聊天对话）
    init(from chat: ChatBookListItem) {
        self.itemId = chat.id
        self.title = chat.name
        self.author = ""  // 聊天对话没有作者概念
        self.url = nil
        self.source = .chats
        self.highlightCount = chat.messageCount
    }
    
    /// 通用初始化器
    init(
        itemId: String,
        title: String,
        author: String,
        url: String?,
        source: HighlightSource,
        highlightCount: Int
    ) {
        self.itemId = itemId
        self.title = title
        self.author = author
        self.url = url
        self.source = source
        self.highlightCount = highlightCount
    }
}

