import Foundation
import SwiftData

// MARK: - Synced Highlight Record

/// 已同步到 Notion 的高亮记录
/// 用于避免每次同步都遍历 Notion children（O(N) API 调用）
/// 通过本地记录实现 O(1) 查询
@Model
final class SyncedHighlightRecord {
    /// 复合主键：sourceKey:bookId:uuid
    /// 用于唯一标识一条高亮记录
    @Attribute(.unique) var compositeKey: String
    
    /// 数据源类型：appleBooks, weRead, dedao, goodLinks
    var sourceKey: String
    
    /// 书籍/文章 ID
    var bookId: String
    
    /// 高亮 UUID（来自数据源）
    var uuid: String
    
    /// Notion block ID（用于更新操作）
    var notionBlockId: String
    
    /// 内容 hash（用于判断是否需要更新）
    /// 使用 NotionHelperMethods.computeModifiedToken() 计算
    var contentHash: String
    
    /// 同步时间
    var syncedAt: Date
    
    // MARK: - Initialization
    
    init(sourceKey: String, bookId: String, uuid: String, notionBlockId: String, contentHash: String) {
        self.compositeKey = "\(sourceKey):\(bookId):\(uuid)"
        self.sourceKey = sourceKey
        self.bookId = bookId
        self.uuid = uuid
        self.notionBlockId = notionBlockId
        self.contentHash = contentHash
        self.syncedAt = Date()
    }
}

// MARK: - Sendable Snapshot

/// 已同步高亮记录的不可变快照（Sendable）
/// 用于跨并发域传递数据
struct SyncedHighlightRecordSnapshot: Sendable {
    let uuid: String
    let notionBlockId: String
    let contentHash: String
    
    init(from record: SyncedHighlightRecord) {
        self.uuid = record.uuid
        self.notionBlockId = record.notionBlockId
        self.contentHash = record.contentHash
    }
    
    init(uuid: String, notionBlockId: String, contentHash: String) {
        self.uuid = uuid
        self.notionBlockId = notionBlockId
        self.contentHash = contentHash
    }
}

// MARK: - ModelContainer Factory

/// SyncedHighlightRecord ModelContainer 工厂
/// 负责创建和管理专用的 ModelContainer
enum SyncedHighlightModelContainerFactory {
    /// 创建专用的 ModelContainer
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            SyncedHighlightRecord.self
        ])
        
        // 使用独立的存储文件，避免与其他 ModelContainer 冲突
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("synced-highlights.store")
        
        // 确保目录存在
        let directory = storeURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            url: storeURL,
            allowsSave: true
        )
        
        return try ModelContainer(
            for: schema,
            configurations: [modelConfiguration]
        )
    }
}
