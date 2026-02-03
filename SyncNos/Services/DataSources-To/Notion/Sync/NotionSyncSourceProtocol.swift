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
    
    // MARK: - Page Content Hooks (Optional)
    
    /// 首次创建页面时的头部内容（可选）
    /// 返回在 "Highlights" 标题之前追加的 Notion blocks
    /// 例如 GoodLinks 需要添加 "Article" 标题和文章内容
    func headerContentForNewPage() -> [[String: Any]]

    /// 创建页面时是否在页面最开始写入一个标题（可选）
    /// - 返回值会作为 `createBookPage(..., header:)` 传入 Notion API
    /// - 默认行为：
    ///   - 若 `headerContentForNewPage()` 为空：返回 "Highlights"（保持历史行为）
    ///   - 若 `headerContentForNewPage()` 非空：返回 nil（确保头部内容在高亮标题之前）
    func pageHeaderTitleForNewPage() -> String?

    /// 新页面追加高亮前是否需要补一个 “Highlights” 标题（可选）
    /// - 典型场景：`pageHeaderTitleForNewPage()` 为 nil（创建页时不写标题），但仍希望在高亮列表之前有标题分隔
    /// - 默认行为：当且仅当 `pageHeaderTitleForNewPage()` 为 nil 时返回 "Highlights"
    func highlightsHeadingTitleForNewPageAppend() -> String?

    /// 判断“头部内容是否已存在”的标题（可选）
    /// - 用于在“无高亮且页面已存在”的场景下，决定是否补齐 `headerContentForNewPage()`。
    /// - 返回一个 heading 标题文本（例如 "Article"），引擎会调用 `pageHasHeading(pageId:title:)` 检测。
    /// - 默认返回 nil（表示不需要做存在性检测/补齐）。
    func headerContentPresenceHeadingTitle() -> String?

    // MARK: - Single Database Override (Optional)

    /// 单一数据库模式下的“整页内容覆盖”输出（可选）
    ///
    /// 典型场景：Chats 希望以 Markdown 风格（`## @xxx`）在页面内排版，而非使用通用的高亮列表结构。
    ///
    /// - 注意：当返回非 nil 时，同步引擎会：
    ///   1) 使用 `setPageChildren` 清空并重建页面 children（破坏性更新）。
    ///   2) 清理该 page 对应的本地 SyncedHighlightRecord（避免旧的 blockId 映射残留）。
    ///   3) 使用 `itemCount` 更新页面的 Highlight Count 与同步时间戳。
    ///
    /// - Returns: 覆盖内容；返回 nil 则走通用高亮同步逻辑。
    func singleDatabasePageOverrideContent() async throws -> NotionSingleDatabasePageOverrideContent?

    /// 用于更新 Notion 页面 “Highlight Count” 的计数（可选）
    /// - 默认返回 `highlights.count`
    /// - 典型场景：Chats 会在高亮序列中插入分组标题（`## @xxx`），但 Highlight Count 仍希望等于真实消息数
    func syncHighlightCount(for highlights: [UnifiedHighlight]) -> Int
    
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
    
    /// 默认无头部内容
    func headerContentForNewPage() -> [[String: Any]] {
        []
    }

    func pageHeaderTitleForNewPage() -> String? {
        // 保持旧行为：大多数数据源在页面开头有 "Highlights"。
        // 但当存在 headerContent（例如文章正文）时，为确保顺序正确，默认不在创建页时写入标题。
        headerContentForNewPage().isEmpty ? "Highlights" : nil
    }

    func highlightsHeadingTitleForNewPageAppend() -> String? {
        // 若创建页时没有写标题，则在追加高亮前补一个标题。
        pageHeaderTitleForNewPage() == nil ? "Highlights" : nil
    }

    func headerContentPresenceHeadingTitle() -> String? {
        nil
    }

    func singleDatabasePageOverrideContent() async throws -> NotionSingleDatabasePageOverrideContent? {
        nil
    }

    func syncHighlightCount(for highlights: [UnifiedHighlight]) -> Int {
        highlights.count
    }
}

// MARK: - Single Database Override Content

/// 单一数据库模式的整页内容覆盖结果
struct NotionSingleDatabasePageOverrideContent {
    /// Notion blocks（用于 `blocks/{pageId}/children`）
    let children: [[String: Any]]

    /// 用于更新页面的 “Highlight Count” 与同步时间戳的计数
    let itemCount: Int
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
    let notionService: NotionClientProtocol
    
    /// 日志服务
    let logger: LoggerServiceProtocol
    
    /// 时间戳存储
    let timestampStore: SyncTimestampStoreProtocol
    
    /// 进度回调
    let progress: (String) -> Void
    
    /// 是否执行增量同步
    let incremental: Bool
}
