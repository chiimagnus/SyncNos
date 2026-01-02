import SwiftUI

/// GoodLinks 数据源 UI 配置
struct GoodLinksUIProvider: DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    let source: ContentSource = .goodLinks
    let displayName = "GoodLinks"
    let iconName = "bookmark"
    var accentColor: Color { Color("BrandGoodLinks") }
    
    // MARK: - 通知配置
    
    let filterChangedNotification: Notification.Name = .goodLinksFilterChanged
    
    // MARK: - 功能配置
    
    let hasFilterMenu = true
    let supportsHighlightColors = true
    let supportsSync = true
    let highlightSource: HighlightSource = .goodLinks
    
    // MARK: - 菜单配置
    
    let menuTitle: LocalizedStringKey = "Articles"
}

