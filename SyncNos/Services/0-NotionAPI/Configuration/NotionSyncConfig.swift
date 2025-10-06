import Foundation

/// 统一管理 Notion 同步相关的默认常量与参数。
///
/// 注意：这些值作为全局默认值供各策略/操作层复用，避免魔法数分散。
/// 如需按源或策略微调，请在业务侧以参数方式覆盖，而不是复制魔法数。
enum NotionSyncConfig {
    // MARK: - Pagination
    /// Apple Books（单库多页）默认分页大小
    static let appleBooksSingleDBPageSize: Int = 100
    /// Apple Books（每书独立库）默认分页大小
    static let appleBooksPerBookPageSize: Int = 50
    /// Apple Books 详情页本地读取默认分页大小
    static let appleBooksDetailPageSize: Int = 50
    /// GoodLinks 默认分页大小
    static let goodLinksPageSize: Int = 200

    // MARK: - Append children with retry
    /// 追加 children 时的默认批次大小
    static let defaultAppendBatchSize: Int = 80
    /// 当单条 block 过大或失败时的降级裁剪阈值序列（依次尝试）
    static let defaultTrimOnFailureLengths: [Int] = [1500, 1000]

    // MARK: - Text trimming
    /// 构建 Notion rich_text 时的首选最大文本长度（与上方裁剪阈值保持一致）
    static let maxTextLengthPrimary: Int = 1500
}


