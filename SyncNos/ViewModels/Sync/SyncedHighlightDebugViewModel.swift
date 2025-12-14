import Foundation
import SwiftData

// MARK: - Debug Display Models

/// 按数据源分组的已同步记录统计
struct SourceRecordGroup: Identifiable {
    let id = UUID()
    let sourceKey: String
    let books: [BookRecordGroup]
    var totalCount: Int { books.reduce(0) { $0 + $1.records.count } }
}

/// 按书籍分组的已同步记录
struct BookRecordGroup: Identifiable {
    let id = UUID()
    let bookId: String
    let records: [SyncedHighlightRecordSnapshot]
}

// MARK: - ViewModel

/// 已同步高亮记录调试视图模型
@MainActor
final class SyncedHighlightDebugViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    @Published var sourceGroups: [SourceRecordGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var totalRecordCount = 0
    
    // MARK: - Dependencies
    
    private let syncedHighlightStore: SyncedHighlightStoreProtocol
    private let logger: LoggerServiceProtocol
    
    // MARK: - Initialization
    
    init(
        syncedHighlightStore: SyncedHighlightStoreProtocol = DIContainer.shared.syncedHighlightStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.syncedHighlightStore = syncedHighlightStore
        self.logger = logger
    }
    
    // MARK: - Data Loading
    
    /// 加载所有已同步记录（按数据源和书籍分组）
    func loadAllRecords() {
        isLoading = true
        errorMessage = nil
        
        Task {
            do {
                // 获取所有数据源的记录
                var allGroups: [SourceRecordGroup] = []
                
                for sourceKey in ["appleBooks", "goodLinks", "weRead", "dedao"] {
                    let bookGroups = try await loadRecordsForSource(sourceKey)
                    if !bookGroups.isEmpty {
                        allGroups.append(SourceRecordGroup(sourceKey: sourceKey, books: bookGroups))
                    }
                }
                
                await MainActor.run {
                    self.sourceGroups = allGroups
                    self.totalRecordCount = allGroups.reduce(0) { $0 + $1.totalCount }
                    self.isLoading = false
                }
                
                logger.debug("[SyncedHighlightDebug] Loaded \(totalRecordCount) records from \(allGroups.count) sources")
                
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                }
                logger.error("[SyncedHighlightDebug] Failed to load records: \(error.localizedDescription)")
            }
        }
    }
    
    /// 加载特定数据源的记录
    private func loadRecordsForSource(_ sourceKey: String) async throws -> [BookRecordGroup] {
        // 由于 SyncedHighlightStore 只支持按 sourceKey + bookId 查询，
        // 我们需要直接访问 ModelContainer 来获取所有记录
        // 这里我们使用一个特殊的方法来获取所有 bookId
        
        let container = try SyncedHighlightModelContainerFactory.createContainer()
        let context = ModelContext(container)
        
        let predicate = #Predicate<SyncedHighlightRecord> { record in
            record.sourceKey == sourceKey
        }
        let descriptor = FetchDescriptor<SyncedHighlightRecord>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.bookId), SortDescriptor(\.syncedAt, order: .reverse)]
        )
        let records = try context.fetch(descriptor)
        
        // 按 bookId 分组
        var bookGroups: [String: [SyncedHighlightRecordSnapshot]] = [:]
        for record in records {
            let snapshot = SyncedHighlightRecordSnapshot(from: record)
            bookGroups[record.bookId, default: []].append(snapshot)
        }
        
        return bookGroups.map { BookRecordGroup(bookId: $0.key, records: $0.value) }
            .sorted { $0.records.count > $1.records.count }
    }
    
    // MARK: - Actions
    
    /// 清除特定书籍的记录
    func clearRecords(sourceKey: String, bookId: String) {
        Task {
            do {
                try await syncedHighlightStore.clearRecords(sourceKey: sourceKey, bookId: bookId)
                logger.info("[SyncedHighlightDebug] Cleared records for \(sourceKey):\(bookId)")
                loadAllRecords() // 刷新
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }
    
    /// 清除特定数据源的所有记录
    func clearAllRecords(sourceKey: String) {
        Task {
            do {
                try await syncedHighlightStore.clearAllRecords(sourceKey: sourceKey)
                logger.info("[SyncedHighlightDebug] Cleared all records for \(sourceKey)")
                loadAllRecords() // 刷新
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }
    
    /// 清除所有记录
    func clearAllSourceRecords() {
        Task {
            do {
                for sourceKey in ["appleBooks", "goodLinks", "weRead", "dedao"] {
                    try await syncedHighlightStore.clearAllRecords(sourceKey: sourceKey)
                }
                logger.info("[SyncedHighlightDebug] Cleared all synced highlight records")
                loadAllRecords() // 刷新
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }
}


