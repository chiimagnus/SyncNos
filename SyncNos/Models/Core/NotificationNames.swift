import Foundation

// MARK: - Notification Names
// 统一定义所有通知名称，避免字符串硬编码，实现类型安全和自动补全

extension Notification.Name {
    
    // MARK: - 数据源筛选变更通知
    /// Apple Books 筛选/排序变更
    static let appleBooksFilterChanged = Notification.Name("AppleBooksFilterChanged")
    
    /// GoodLinks 筛选/排序变更
    static let goodLinksFilterChanged = Notification.Name("GoodLinksFilterChanged")
    
    /// WeRead 筛选/排序变更
    static let weReadFilterChanged = Notification.Name("WeReadFilterChanged")
    
    /// Dedao 筛选/排序变更
    static let dedaoFilterChanged = Notification.Name("DedaoFilterChanged")
    
    /// Chats 筛选/排序变更
    static let chatsFilterChanged = Notification.Name("ChatsFilterChanged")
    
    // MARK: - 高亮排序/筛选
    /// 高亮排序变更
    static let highlightSortChanged = Notification.Name("HighlightSortChanged")
    
    /// 高亮筛选变更
    static let highlightFilterChanged = Notification.Name("HighlightFilterChanged")
    
    // MARK: - 同步状态通知
    
    /// 书籍/文章同步状态变更
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
    
    /// 同步进度更新
    static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
    
    /// 同步队列任务被选中（用于跳转）
    static let syncQueueTaskSelected = Notification.Name("SyncQueueTaskSelected")
    
    // MARK: - 全局操作通知
    /// 请求同步选中项到 Notion
    static let syncSelectedToNotionRequested = Notification.Name("SyncSelectedToNotionRequested")
    
    /// 请求完整重新同步选中项
    static let fullResyncSelectedRequested = Notification.Name("FullResyncSelectedRequested")
    
    /// 请求刷新当前数据源
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    
    // MARK: - 弹窗通知
    /// 显示 Notion 配置弹窗
    static let showNotionConfigAlert = Notification.Name("ShowNotionConfigAlert")
    
    /// 显示会话过期弹窗
    static let showSessionExpiredAlert = Notification.Name("ShowSessionExpiredAlert")
    
    /// 导航到 Notion 设置
    static let navigateToNotionSettings = Notification.Name("NavigateToNotionSettings")
    
    // MARK: - 自动同步通知
    /// 自动同步状态变更
    static let autoSyncStatusChanged = Notification.Name("AutoSyncStatusChanged")
    
    // MARK: - 字体缩放通知
    /// 字体缩放变更
    static let fontScaleChanged = Notification.Name("FontScaleChanged")
}

// MARK: - ContentSource 通知扩展

extension ContentSource {
    /// 该数据源的筛选变更通知名称
    var filterChangedNotification: Notification.Name {
        switch self {
        case .appleBooks: return .appleBooksFilterChanged
        case .goodLinks: return .goodLinksFilterChanged
        case .weRead: return .weReadFilterChanged
        case .dedao: return .dedaoFilterChanged
        case .chats: return .chatsFilterChanged
        }
    }
}

