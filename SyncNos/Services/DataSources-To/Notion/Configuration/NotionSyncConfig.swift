import Foundation

/// 统一管理 Notion 同步相关的默认常量与参数。
enum NotionSyncConfig {
    // MARK: - Pagination
    /// Apple Books（单库多页）默认分页大小
    static let appleBooksSingleDBPageSize: Int = 100
    /// Apple Books（每书独立库）默认分页大小
    static let appleBooksPerBookPageSize: Int = 100
    /// Apple Books 详情页本地读取默认分页大小
    static let appleBooksDetailPageSize: Int = 100
    /// GoodLinks 默认分页大小
    static let goodLinksPageSize: Int = 100

    /// 追加 children 时的默认批次大小
    /// 减小到 50 可以降低单次 API 调用的负载，减少超时风险
    static let defaultAppendBatchSize: Int = 50

    // MARK: - Text trimming
    /// 构建 Notion rich_text 时的首选最大文本长度（与上方裁剪阈值保持一致）
    static let maxTextLengthPrimary: Int = 1500

    // MARK: - Placeholder
    /// 当 per-book 模式下高亮/笔记内容过大时用于占位的文本
    static let placeholderTooLargeText: String = "已跳过：内容过大"

    // MARK: - Feature flags
    /// 是否启用通过列举 page children 来复用已存在的 child_database（谨慎默认关闭）
    static let enablePageChildLookup: Bool = false

    // MARK: - Concurrency & Rate limiting
    /// 批量同步并发上限（统一用于手动批量与自动同步）
    static let batchConcurrency: Int = 3
    /// Notion 读取类请求速率（RPS）上限：GET、databases/*/query
    static let notionReadRequestsPerSecond: Int = 8
    /// Notion 写入类请求速率（RPS）上限：POST/PUT/PATCH/DELETE（非查询）
    static let notionWriteRequestsPerSecond: Int = 3

    // MARK: - Retry on 429
    /// 429 最大重试次数
    static let retryMaxAttempts: Int = 6
    /// 429 指数退避起始毫秒
    static let retryBaseBackoffMs: UInt64 = 500
    /// 退避抖动（毫秒）
    static let retryJitterMs: UInt64 = 250

    // MARK: - Retry on 409 (conflict)
    /// 409 最大重试次数（Notion 返回 conflict_error 时的重试）
    static let retryConflictMaxAttempts: Int = 6
    /// 409 指数退避起始毫秒
    static let retryConflictBaseBackoffMs: UInt64 = 300
    /// 409 退避抖动（毫秒）
    static let retryConflictJitterMs: UInt64 = 200
    
    // MARK: - Timeout
    /// Notion API 请求超时时间（秒）
    /// 对于大量数据的同步（如 6000 条笔记），需要更长的超时时间
    static let requestTimeoutSeconds: TimeInterval = 120
}
