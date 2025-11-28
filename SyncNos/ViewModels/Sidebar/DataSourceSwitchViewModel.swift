import Foundation
import Combine
import AppKit

/// 数据源切换 ViewModel
/// 管理侧边栏滑动切换的状态和逻辑
/// 
/// 注意：已启用的数据源列表由外层 View 通过 `updateEnabledDataSources(_:)` 显式注入，
/// 不再直接监听 UserDefaults，避免双向数据流导致的循环更新和 UI 卡死。
@MainActor
final class DataSourceSwitchViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    /// 当前活动的数据源索引
    @Published var activeIndex: Int = 0
    
    /// 已启用的数据源列表（由外层 View 注入，而不是直接读取 UserDefaults）
    @Published private(set) var enabledDataSources: [ContentSource] = []
    
    // MARK: - Computed Properties
    
    /// 当前活动的数据源类型
    var currentDataSource: ContentSource? {
        guard activeIndex >= 0 && activeIndex < enabledDataSources.count else { return nil }
        return enabledDataSources[activeIndex]
    }
    
    /// 是否有可用的数据源
    var hasEnabledSources: Bool {
        !enabledDataSources.isEmpty
    }
    
    // MARK: - Initialization
    
    init() {
        // 默认使用空列表，具体启用的数据源由外层 View 通过 `updateEnabledDataSources(_:)` 注入
    }
    
    // MARK: - Public Methods
    
    /// 切换到指定索引的数据源
    /// - Parameter index: 目标索引
    func switchTo(index: Int) {
        guard index >= 0 && index < enabledDataSources.count else { return }
        guard index != activeIndex else { return }
        
        activeIndex = index
        triggerHapticFeedback()
        
        // 发送通知让对应的 ListView 获取焦点
        if let source = enabledDataSources[safe: index] {
            notifyDataSourceSwitch(to: source)
        }
    }
    
    /// 切换到指定类型的数据源
    /// - Parameter source: 目标数据源类型
    func switchTo(source: ContentSource) {
        guard let index = enabledDataSources.firstIndex(of: source) else { return }
        switchTo(index: index)
    }
    
    /// 更新启用的数据源列表（由外部显式传入当前启用的数据源集合）
    /// - Parameter sources: 当前启用的数据源列表，顺序应与 `ContentSource.allCases` 保持一致
    func updateEnabledDataSources(_ sources: [ContentSource]) {
        enabledDataSources = sources
        ensureValidActiveIndex()
    }
    
    /// 触发触觉反馈
    func triggerHapticFeedback() {
        NSHapticFeedbackManager.defaultPerformer.perform(
            .alignment,
            performanceTime: .default
        )
    }
    
    // MARK: - Private Methods
    
    /// 发送数据源切换通知，让对应的 ListView 获取焦点
    private func notifyDataSourceSwitch(to source: ContentSource) {
        let notificationName: Notification.Name
        switch source {
        case .appleBooks:
            notificationName = Notification.Name("DataSourceSwitchedToAppleBooks")
        case .goodLinks:
            notificationName = Notification.Name("DataSourceSwitchedToGoodLinks")
        case .weRead:
            notificationName = Notification.Name("DataSourceSwitchedToWeRead")
        }
        // 延迟发送，确保视图切换动画完成
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            NotificationCenter.default.post(name: notificationName, object: nil)
        }
    }
    
    private func ensureValidActiveIndex() {
        if enabledDataSources.isEmpty {
            activeIndex = 0
        } else if activeIndex >= enabledDataSources.count {
            activeIndex = enabledDataSources.count - 1
        }
    }
}

// MARK: - Array Safe Subscript Extension
private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
