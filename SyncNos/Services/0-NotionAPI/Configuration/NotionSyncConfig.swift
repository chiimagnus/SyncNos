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
    static let defaultAppendBatchSize: Int = 100

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
    /// Notion 全局请求速率（RPS）上限，用于请求级限流
    static let notionRequestsPerSecond: Int = 3

    // MARK: - Retry on 429
    /// 429 最大重试次数
    static let retryMaxAttempts: Int = 6
    /// 429 指数退避起始毫秒
    static let retryBaseBackoffMs: UInt64 = 500
    /// 退避抖动（毫秒）
    static let retryJitterMs: UInt64 = 250
}


