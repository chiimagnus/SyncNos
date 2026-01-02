import SwiftUI

// MARK: - DataSourceUIProvider 协议

/// 数据源 UI 配置协议
/// 每个数据源（Apple Books、GoodLinks 等）实现此协议以提供 UI 相关配置
///
/// **设计目的**:
/// - 消除 switch 语句：通过协议属性获取配置，无需根据 ContentSource 判断
/// - 统一接口：所有数据源使用相同的协议接口
/// - 可扩展性：添加新数据源只需实现此协议并注册
protocol DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    /// 数据源标识符
    var source: ContentSource { get }
    
    /// 显示名称
    var displayName: String { get }
    
    /// SF Symbol 图标名称
    var iconName: String { get }
    
    /// 品牌强调色
    var accentColor: Color { get }
    
    // MARK: - 通知配置
    
    /// 筛选变更通知名称
    var filterChangedNotification: Notification.Name { get }
    
    // MARK: - 功能配置
    
    /// 是否有筛选菜单
    var hasFilterMenu: Bool { get }
    
    /// 是否支持高亮颜色筛选
    var supportsHighlightColors: Bool { get }
    
    /// 是否支持同步到 Notion
    var supportsSync: Bool { get }
    
    /// 高亮颜色来源（用于 HighlightColorScheme）
    var highlightSource: HighlightSource { get }
    
    // MARK: - 菜单配置
    
    /// 菜单标题（如 "Books", "Articles"）
    var menuTitle: LocalizedStringKey { get }
}

// MARK: - SortKeyType 协议

/// 排序键协议
/// 用于定义数据源的排序选项
protocol SortKeyType: CaseIterable, Hashable, RawRepresentable where RawValue == String {
    var displayName: LocalizedStringResource { get }
}

// MARK: - 现有排序键的协议实现

extension BookListSortKey: SortKeyType {}
extension GoodLinksSortKey: SortKeyType {}

// MARK: - 空排序键（用于不支持排序的数据源如 Chats）

/// 空排序键（用于不支持自定义排序的数据源）
enum NoSortKey: String, SortKeyType, CaseIterable {
    case none = "none"
    
    var displayName: LocalizedStringResource { "Default" }
}

