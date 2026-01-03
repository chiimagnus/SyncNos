import SwiftUI

/// Dedao（得到）数据源 UI 配置
struct DedaoUIProvider: DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    let source: ContentSource = .dedao
    let displayName = "Dedao"
    let iconName = "d.square"
    var accentColor: Color { Color("BrandDedao") }
    
    // MARK: - 通知配置
    
    let filterChangedNotification: Notification.Name = .dedaoFilterChanged
    
    // MARK: - 功能配置
    
    let hasFilterMenu = true
    let supportsHighlightColors = false  // 得到不提供高亮颜色
    let supportsSync = true
    let highlightSource: HighlightSource = .dedao
    
    // MARK: - 菜单配置
    
    let menuTitle: LocalizedStringKey = "Books"
    
    // MARK: - 存储配置
    
    let enabledStorageKey = "datasource.dedao.enabled"
    
    // MARK: - 高亮颜色
    
    let highlightColorTheme: HighlightColorTheme? = .dedao
}

