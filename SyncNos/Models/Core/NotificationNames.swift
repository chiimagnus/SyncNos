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
    
    /// 同步开始
    static let syncBookStarted = Notification.Name("SyncBookStarted")
    
    /// 同步完成
    static let syncBookFinished = Notification.Name("SyncBookFinished")
    
    /// 同步队列任务被选中（用于跳转）
    static let syncQueueTaskSelected = Notification.Name("SyncQueueTaskSelected")
    
    // MARK: - 全局操作通知
    
    /// 请求同步选中项到 Notion
    static let syncSelectedToNotionRequested = Notification.Name("SyncSelectedToNotionRequested")
    
    /// 请求完整重新同步选中项
    static let fullResyncSelectedRequested = Notification.Name("FullResyncSelectedRequested")
    
    /// 请求刷新当前数据源
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    
    // MARK: - 弹窗/导航通知
    
    /// 显示 Notion 配置弹窗
    static let showNotionConfigAlert = Notification.Name("ShowNotionConfigAlert")
    
    /// 显示会话过期弹窗
    static let showSessionExpiredAlert = Notification.Name("ShowSessionExpiredAlert")
    
    /// 导航到 Notion 设置
    static let navigateToNotionSettings = Notification.Name("NavigateToNotionSettings")
    
    /// 导航到 WeRead 设置
    static let navigateToWeReadSettings = Notification.Name("NavigateToWeReadSettings")
    
    /// 导航到 WeRead 登录
    static let navigateToWeReadLogin = Notification.Name("NavigateToWeReadLogin")
    
    /// 导航到 Dedao 设置
    static let navigateToDedaoSettings = Notification.Name("NavigateToDedaoSettings")
    
    /// 导航到 Dedao 登录
    static let navigateToDedaoLogin = Notification.Name("NavigateToDedaoLogin")
    
    // MARK: - 自动同步通知
    
    /// 自动同步状态变更
    static let autoSyncStatusChanged = Notification.Name("AutoSyncStatusChanged")
    
    // MARK: - 字体缩放通知
    
    /// 字体缩放变更
    static let fontScaleChanged = Notification.Name("FontScaleChanged")
    
    /// 字体缩放变更（带命名空间，用于 FontScaleManager）
    static let fontScaleDidChange = Notification.Name("SyncNos.FontScaleDidChange")
    
    // MARK: - 登录状态通知
    
    /// WeRead 登录状态变更
    static let weReadLoginStatusChanged = Notification.Name("WeReadLoginStatusChanged")
    
    /// WeRead 登录成功
    static let weReadLoginSucceeded = Notification.Name("WeReadLoginSucceeded")
    
    /// Dedao 登录状态变更
    static let dedaoLoginStatusChanged = Notification.Name("DedaoLoginStatusChanged")
    
    /// Dedao 登录成功
    static let dedaoLoginSucceeded = Notification.Name("DedaoLoginSucceeded")
    
    // MARK: - 数据源顺序/选择通知
    
    /// 数据源顺序变更
    static let dataSourceOrderChanged = Notification.Name("DataSourceOrderChanged")
    
    /// Apple Books 数据库容器被选中
    static let appleBooksContainerSelected = Notification.Name("AppleBooksContainerSelected")
    
    /// GoodLinks 文件夹被选中
    static let goodLinksFolderSelected = Notification.Name("GoodLinksFolderSelected")
    
    // MARK: - 设置视图通知
    
    /// WeRead 设置显示登录弹窗
    static let weReadSettingsShowLoginSheet = Notification.Name("WeReadSettingsShowLoginSheet")
    
    /// Dedao 设置显示登录弹窗
    static let dedaoSettingsShowLoginSheet = Notification.Name("DedaoSettingsShowLoginSheet")
    
    // MARK: - 应用退出通知
    
    /// 跳过退出确认（一次性）
    static let bypassQuitConfirmationOnce = Notification.Name("BypassQuitConfirmationOnce")
    
    // MARK: - IAP 通知
    
    /// IAP 服务状态变更
    static let iapServiceStatusChanged = Notification.Name("IAPServiceStatusChanged")
    
    /// IAP 显示欢迎弹窗
    static let iapServiceShowWelcome = Notification.Name("IAPServiceShowWelcome")
    
    /// IAP 显示试用提醒弹窗
    static let iapServiceShowTrialReminder = Notification.Name("IAPServiceShowTrialReminder")
    
    // MARK: - 应用图标通知
    
    /// 应用图标显示模式变更
    static let appIconDisplayModeChanged = Notification.Name("AppIconDisplayModeChanged")
    
    // MARK: - Chats 通知
    
    /// 导航到聊天消息
    static let chatsNavigateMessage = Notification.Name("ChatsNavigateMessage")
    
    /// 循环切换消息分类
    static let chatsCycleClassification = Notification.Name("ChatsCycleClassification")
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
    
    /// 该数据源的 List 焦点请求通知名称
    var listFocusRequestedNotification: Notification.Name {
        Notification.Name("ListFocusRequested.\(rawValue)")
    }
}
