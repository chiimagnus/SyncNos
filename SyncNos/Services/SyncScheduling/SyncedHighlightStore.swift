import Foundation
import SwiftData

// MARK: - Synced Highlight Store Protocol

/// 已同步高亮记录存储协议
protocol SyncedHighlightStoreProtocol: Sendable {
    /// 获取某本书已同步的记录快照
    func getRecords(sourceKey: String, bookId: String) async throws -> [SyncedHighlightRecordSnapshot]
    
    /// 批量保存记录
    func saveRecords(_ records: [(uuid: String, notionBlockId: String, contentHash: String)], sourceKey: String, bookId: String) async throws
    
    /// 更新单条记录的 contentHash
    func updateContentHash(sourceKey: String, bookId: String, uuid: String, newContentHash: String) async throws
    
    /// 清除某本书的所有记录（用于"完整重新同步"）
    func clearRecords(sourceKey: String, bookId: String) async throws
    
    /// 清除某个数据源的所有记录
    func clearAllRecords(sourceKey: String) async throws
    
    /// 获取某本书已同步的记录数量
    func getRecordCount(sourceKey: String, bookId: String) async throws -> Int
}

// MARK: - Synced Highlight Store Implementation

/// 已同步高亮记录存储服务
/// 使用 @ModelActor 在后台线程执行所有数据库操作，不阻塞主线程
@ModelActor
actor SyncedHighlightStore: SyncedHighlightStoreProtocol {
    // 使用全局 logger 而不是存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    // MARK: - 读取操作
    
    /// 获取某本书已同步的记录快照
    func getRecords(sourceKey: String, bookId: String) throws -> [SyncedHighlightRecordSnapshot] {
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.sourceKey == sourceKey && record.bookId == bookId
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(predicate: predicate)
        let records = try modelContext.fetch(descriptor)
        return records.map { SyncedHighlightRecordSnapshot(from: $0) }
    }
    
    /// 获取某本书已同步的记录数量
    func getRecordCount(sourceKey: String, bookId: String) throws -> Int {
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.sourceKey == sourceKey && record.bookId == bookId
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(predicate: predicate)
        return try modelContext.fetchCount(descriptor)
    }
    
    // MARK: - 写入操作
    
    /// 批量保存记录
    func saveRecords(_ records: [(uuid: String, notionBlockId: String, contentHash: String)], sourceKey: String, bookId: String) throws {
        for record in records {
            let newRecord = SyncedHighlightRecord(
                sourceKey: sourceKey,
                bookId: bookId,
                uuid: record.uuid,
                notionBlockId: record.notionBlockId,
                contentHash: record.contentHash
            )
            modelContext.insert(newRecord)
        }
        try modelContext.save()
        logger.debug("[SyncedHighlightStore] Saved \(records.count) records for \(sourceKey):\(bookId)")
    }
    
    /// 更新单条记录的 contentHash
    func updateContentHash(sourceKey: String, bookId: String, uuid: String, newContentHash: String) throws {
        let compositeKey = "\(sourceKey):\(bookId):\(uuid)"
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.compositeKey == compositeKey
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(predicate: predicate)
        let records = try modelContext.fetch(descriptor)
        
        if let record = records.first {
            record.contentHash = newContentHash
            record.syncedAt = Date()
            try modelContext.save()
            logger.debug("[SyncedHighlightStore] Updated contentHash for \(compositeKey)")
        } else {
            logger.warning("[SyncedHighlightStore] Record not found for update: \(compositeKey)")
        }
    }
    
    // MARK: - 删除操作
    
    /// 清除某本书的所有记录
    func clearRecords(sourceKey: String, bookId: String) throws {
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.sourceKey == sourceKey && record.bookId == bookId
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(predicate: predicate)
        let records = try modelContext.fetch(descriptor)
        
        for record in records {
            modelContext.delete(record)
        }
        try modelContext.save()
        logger.info("[SyncedHighlightStore] Cleared \(records.count) records for \(sourceKey):\(bookId)")
    }
    
    /// 清除某个数据源的所有记录
    func clearAllRecords(sourceKey: String) throws {
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.sourceKey == sourceKey
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(predicate: predicate)
        let records = try modelContext.fetch(descriptor)
        
        for record in records {
            modelContext.delete(record)
        }
        try modelContext.save()
        logger.info("[SyncedHighlightStore] Cleared all \(records.count) records for \(sourceKey)")
    }
}
