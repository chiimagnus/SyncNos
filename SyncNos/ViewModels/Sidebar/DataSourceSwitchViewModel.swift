import Foundation
import Combine
import AppKit

/// 数据源切换 ViewModel
/// 管理侧边栏滑动切换的状态和逻辑
@MainActor
final class DataSourceSwitchViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    /// 当前活动的数据源索引
    @Published var activeIndex: Int = 0
    
    /// 已启用的数据源列表
    @Published private(set) var enabledDataSources: [ContentSource] = []
    
    // MARK: - Private Properties
    
    private var cancellables = Set<AnyCancellable>()
    
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
        loadEnabledDataSources()
        setupUserDefaultsObservers()
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
    
    /// 触发触觉反馈
    func triggerHapticFeedback() {
        NSHapticFeedbackManager.defaultPerformer.perform(
            .alignment,
            performanceTime: .default
        )
    }
    
    /// 刷新启用的数据源列表
    func refreshEnabledDataSources() {
        loadEnabledDataSources()
    }
    
    // MARK: - Private Methods
    
    private func loadEnabledDataSources() {
        enabledDataSources = ContentSource.allCases.filter { source in
            UserDefaults.standard.bool(forKey: source.enabledKey)
        }
        
        // 确保当前索引有效
        ensureValidActiveIndex()
    }
    
    private func ensureValidActiveIndex() {
        if enabledDataSources.isEmpty {
            activeIndex = 0
        } else if activeIndex >= enabledDataSources.count {
            activeIndex = enabledDataSources.count - 1
        }
    }
    
    private func setupUserDefaultsObservers() {
        // 监听 UserDefaults 变化
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.loadEnabledDataSources()
            }
            .store(in: &cancellables)
    }
}

// MARK: - Array Safe Subscript Extension
private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

