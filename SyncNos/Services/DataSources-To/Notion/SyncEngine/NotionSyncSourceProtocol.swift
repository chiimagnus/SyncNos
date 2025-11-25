import Foundation

// MARK: - Notion Sync Strategy

/// 同步策略枚举
enum NotionSyncStrategy: String, CaseIterable {
    /// 单一数据库模式：所有书籍在一个数据库中，每本书一个页面
    case singleDatabase = "single"
    
    /// 每本书独立数据库模式：每本书创建一个数据库，每条高亮为一个条目
    case perBookDatabase = "perBook"
}

// MARK: - Notion Sync Source Protocol

/// 数据源适配器协议
/// 每个新数据源只需实现此协议即可接入同步引擎
protocol NotionSyncSourceProtocol {
    
    // MARK: - Source Identification
    
    /// 数据源标识符（用于数据库命名、配置存储等）
    /// 例如: "appleBooks", "goodLinks", "weRead"
    var sourceKey: String { get }
    
    /// Notion 数据库标题前缀
    /// 例如: "SyncNos-AppleBooks"
    var databaseTitle: String { get }
    
    /// 数据来源类型
    var highlightSource: HighlightSource { get }
    
    // MARK: - Item Information
    
    /// 当前同步项目（书籍/文章）的统一信息
    var syncItem: UnifiedSyncItem { get }
    
    // MARK: - Database Schema
    
    /// 额外的数据库属性定义（除了通用属性外）
    /// 例如 GoodLinks 需要 Tags、Summary、Starred 等
    var additionalPropertyDefinitions: [String: Any] { get }
    
    // MARK: - Data Fetching
    
    /// 获取高亮数据（转换为统一格式）
    /// - Returns: 统一格式的高亮列表
    func fetchHighlights() async throws -> [UnifiedHighlight]
    
    // MARK: - Page Properties
    
    /// 获取额外的页面属性（用于更新 Notion 页面）
    /// 例如 GoodLinks 需要设置 Tags、Starred 等
    func additionalPageProperties() -> [String: Any]
    
    // MARK: - Strategy Support (Optional)
    
    /// 支持的同步策略（默认只支持 singleDatabase）
    var supportedStrategies: [NotionSyncStrategy] { get }
    
    /// 当前使用的同步策略
    var currentStrategy: NotionSyncStrategy { get }
}

// MARK: - Default Implementations

extension NotionSyncSourceProtocol {
    
    /// 默认只支持单一数据库策略
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]
    }
    
    /// 默认使用单一数据库策略
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    /// 默认无额外属性定义
    var additionalPropertyDefinitions: [String: Any] {
        [:]
    }
    
    /// 默认无额外页面属性
    func additionalPageProperties() -> [String: Any] {
        [:]
    }
}

// MARK: - Per-Book Strategy Extension

/// 支持每本书独立数据库策略的适配器扩展协议
protocol NotionPerBookSyncSourceProtocol: NotionSyncSourceProtocol {
    
    /// 每本书数据库的属性定义
    var perBookPropertyDefinitions: [String: Any] { get }
    
    /// 构建单条高亮的属性（用于 perBook 模式）
    func buildHighlightProperties(for highlight: UnifiedHighlight) -> [String: Any]
    
    /// 构建单条高亮的页面子块（用于 perBook 模式）
    func buildHighlightChildren(for highlight: UnifiedHighlight) -> [[String: Any]]
}

// MARK: - Sync Context

/// 同步上下文，包含同步过程中需要的状态信息
struct NotionSyncContext {
    /// Notion 配置
    let notionConfig: NotionConfigStoreProtocol
    
    /// Notion 服务
    let notionService: NotionServiceProtocol
    
    /// 日志服务
    let logger: LoggerServiceProtocol
    
    /// 时间戳存储
    let timestampStore: SyncTimestampStoreProtocol
    
    /// 进度回调
    let progress: (String) -> Void
    
    /// 是否执行增量同步
    let incremental: Bool
}

