import SwiftUI

/// Apple Books 数据源 UI 配置
struct AppleBooksUIProvider: DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    let source: ContentSource = .appleBooks
    let displayName = "Apple Books"
    let iconName = "book"
    var accentColor: Color { Color("BrandAppleBooks") }
    
    // MARK: - 通知配置
    
    let filterChangedNotification: Notification.Name = .appleBooksFilterChanged
    
    // MARK: - 功能配置
    
    let hasFilterMenu = true
    let supportsHighlightColors = true
    let supportsSync = true
    let highlightSource: HighlightSource = .appleBooks
    
    // MARK: - 菜单配置
    
    let menuTitle: LocalizedStringKey = "Books"
    
    // MARK: - 存储配置
    
    let enabledStorageKey = "datasource.appleBooks.enabled"
    
    // MARK: - 高亮颜色
    
    let highlightColorTheme: HighlightColorTheme? = .appleBooks
}

