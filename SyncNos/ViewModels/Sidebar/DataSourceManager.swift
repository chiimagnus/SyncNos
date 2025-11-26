import Foundation
import SwiftUI
import Combine

// MARK: - DataSourceManager

/// 数据源管理器 - 管理所有数据源的状态
@MainActor
final class DataSourceManager: ObservableObject {
    
    // MARK: - Published Properties
    
    /// 所有数据源
    @Published private(set) var dataSources: [DataSource] = []
    
    /// 当前活动的数据源
    @Published var currentDataSource: DataSource?
    
    /// 当前活动的数据源索引
    @Published var activeIndex: Int = 0
    
    // MARK: - Private Properties
    
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Computed Properties
    
    /// 已启用的数据源
    var enabledDataSources: [DataSource] {
        dataSources.filter { $0.isEnabled }
    }
    
    /// 是否有可用的数据源
    var hasEnabledSources: Bool {
        !enabledDataSources.isEmpty
    }
    
    // MARK: - Initialization
    
    init() {
        loadDataSources()
        setupBindings()
    }
    
    // MARK: - Public Methods
    
    /// 设置活动数据源
    func setActiveDataSource(_ dataSource: DataSource) {
        guard enabledDataSources.contains(where: { $0.id == dataSource.id }) else { return }
        currentDataSource = dataSource
        
        // 更新索引
        if let index = enabledDataSources.firstIndex(where: { $0.id == dataSource.id }) {
            activeIndex = index
        }
        
        // 触发触觉反馈
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }
    
    /// 根据索引设置活动数据源
    func setActiveDataSource(at index: Int) {
        let sources = enabledDataSources
        guard index >= 0 && index < sources.count else { return }
        setActiveDataSource(sources[index])
    }
    
    /// 启用/禁用数据源
    func setEnabled(_ isEnabled: Bool, for type: DataSourceType) {
        guard let dataSource = dataSources.first(where: { $0.type == type }) else { return }
        dataSource.isEnabled = isEnabled
        UserDefaults.standard.set(isEnabled, forKey: type.enabledKey)
        
        // 如果当前数据源被禁用，切换到第一个可用的
        if !isEnabled && currentDataSource?.type == type {
            currentDataSource = enabledDataSources.first
            activeIndex = 0
        }
        
        objectWillChange.send()
    }
    
    /// 刷新数据源状态
    func refreshDataSources() {
        for dataSource in dataSources {
            dataSource.isEnabled = UserDefaults.standard.bool(forKey: dataSource.type.enabledKey)
        }
        
        // 确保当前数据源仍然有效
        ensureValidCurrentSource()
        objectWillChange.send()
    }
    
    /// 获取指定类型的数据源
    func dataSource(for type: DataSourceType) -> DataSource? {
        dataSources.first { $0.type == type }
    }
    
    // MARK: - Private Methods
    
    private func loadDataSources() {
        // 创建所有数据源
        dataSources = DataSourceType.allCases.map { type in
            let isEnabled = UserDefaults.standard.bool(forKey: type.enabledKey)
            return type.createDataSource(isEnabled: isEnabled)
        }
        
        // 设置初始活动数据源
        currentDataSource = enabledDataSources.first
    }
    
    private func setupBindings() {
        // 监听活动索引变化
        $activeIndex
            .removeDuplicates()
            .sink { [weak self] newIndex in
                guard let self else { return }
                let sources = enabledDataSources
                guard newIndex >= 0 && newIndex < sources.count else { return }
                
                let targetSource = sources[newIndex]
                if currentDataSource?.id != targetSource.id {
                    currentDataSource = targetSource
                }
            }
            .store(in: &cancellables)
        
        // 监听当前数据源变化，同步索引
        $currentDataSource
            .compactMap { $0 }
            .sink { [weak self] source in
                guard let self else { return }
                if let index = enabledDataSources.firstIndex(where: { $0.id == source.id }) {
                    if activeIndex != index {
                        activeIndex = index
                    }
                }
            }
            .store(in: &cancellables)
    }
    
    private func ensureValidCurrentSource() {
        let enabled = enabledDataSources
        guard !enabled.isEmpty else {
            currentDataSource = nil
            activeIndex = 0
            return
        }
        
        // 如果当前数据源无效，切换到第一个可用的
        if let current = currentDataSource, !enabled.contains(where: { $0.id == current.id }) {
            currentDataSource = enabled.first
            activeIndex = 0
        } else if currentDataSource == nil {
            currentDataSource = enabled.first
            activeIndex = 0
        }
    }
}

// MARK: - DataSourceManager 扩展

extension DataSourceManager {
    /// 获取当前数据源类型
    var currentType: DataSourceType? {
        currentDataSource?.type
    }
    
    /// 是否为指定类型
    func isCurrentType(_ type: DataSourceType) -> Bool {
        currentDataSource?.type == type
    }
}

