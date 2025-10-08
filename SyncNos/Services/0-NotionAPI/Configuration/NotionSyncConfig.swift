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
}


