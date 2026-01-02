import SwiftUI

/// WeRead（微信读书）数据源 UI 配置
struct WeReadUIProvider: DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    let source: ContentSource = .weRead
    let displayName = "WeRead"
    let iconName = "w.square"
    var accentColor: Color { Color("BrandWeRead") }
    
    // MARK: - 通知配置
    
    let filterChangedNotification: Notification.Name = .weReadFilterChanged
    
    // MARK: - 功能配置
    
    let hasFilterMenu = true
    let supportsHighlightColors = true
    let supportsSync = true
    let highlightSource: HighlightSource = .weRead
    
    // MARK: - 菜单配置
    
    let menuTitle: LocalizedStringKey = "Books"
}

