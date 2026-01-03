import SwiftUI

// MARK: - DataSourceRegistry

/// 数据源注册表
/// 集中管理所有数据源的 UI 配置，消除 switch 语句
///
/// **使用方式**:
/// ```swift
/// // 获取数据源配置
/// let provider = DataSourceRegistry.shared.provider(for: .appleBooks)
///
/// // 或通过 ContentSource 扩展
/// let notification = ContentSource.appleBooks.uiProvider?.filterChangedNotification
/// ```
@MainActor
final class DataSourceRegistry {
    
    /// 单例实例（注册表是只读的，使用单例是安全的）
    static let shared = DataSourceRegistry()
    
    /// 所有注册的数据源配置（按 ContentSource 索引）
    private var providers: [ContentSource: any DataSourceUIProvider] = [:]
    
    private init() {
        // 注册所有数据源
        register(AppleBooksUIProvider())
        register(GoodLinksUIProvider())
        register(WeReadUIProvider())
        register(DedaoUIProvider())
        register(ChatsUIProvider())
    }
    
    // MARK: - Public API
    
    /// 注册数据源配置
    func register(_ provider: any DataSourceUIProvider) {
        providers[provider.source] = provider
    }
    
    /// 获取数据源配置
    func provider(for source: ContentSource) -> (any DataSourceUIProvider)? {
        providers[source]
    }
    
    /// 获取所有已注册的数据源
    var allSources: [ContentSource] {
        Array(providers.keys).sorted { $0.rawValue < $1.rawValue }
    }
    
    /// 获取所有 UIProvider
    var allProviders: [any DataSourceUIProvider] {
        allSources.compactMap { providers[$0] }
    }
}

// MARK: - ContentSource 扩展（代理到 Registry）

extension ContentSource {
    /// 获取该数据源的 UI 配置
    @MainActor
    var uiProvider: (any DataSourceUIProvider)? {
        DataSourceRegistry.shared.provider(for: self)
    }
    
    /// 筛选变更通知名称
    @MainActor
    var filterChangedNotification: Notification.Name {
        uiProvider?.filterChangedNotification ?? Notification.Name("UnknownFilterChanged")
    }
    
    /// 高亮颜色主题（可选，Chats 等不支持的返回 nil）
    @MainActor
    var highlightColorTheme: HighlightColorTheme? {
        uiProvider?.highlightColorTheme
    }
    
    /// 高亮颜色来源
    @MainActor
    var highlightSource: HighlightSource {
        uiProvider?.highlightSource ?? .appleBooks
    }
    
    /// UserDefaults 启用状态存储键
    @MainActor
    var enabledStorageKey: String {
        uiProvider?.enabledStorageKey ?? "datasource.\(rawValue).enabled"
    }
}

