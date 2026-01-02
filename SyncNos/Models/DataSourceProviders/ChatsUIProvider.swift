import SwiftUI

/// Chats（对话截图）数据源 UI 配置
struct ChatsUIProvider: DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    let source: ContentSource = .chats
    let displayName = "Chats"
    let iconName = "message"
    var accentColor: Color { .green }
    
    // MARK: - 通知配置
    
    let filterChangedNotification: Notification.Name = .chatsFilterChanged
    
    // MARK: - 功能配置
    
    let hasFilterMenu = false  // Chats 目前不需要筛选菜单
    let supportsHighlightColors = false  // Chats 使用消息方向而非颜色
    let supportsSync = true
    let highlightSource: HighlightSource = .chats
    
    // MARK: - 菜单配置
    
    let menuTitle: LocalizedStringKey = "Contacts"
}

