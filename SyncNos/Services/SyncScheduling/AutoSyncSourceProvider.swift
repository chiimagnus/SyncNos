import Foundation

/// 抽象单个数据源的自动同步逻辑，便于按源扩展（Apple Books / GoodLinks / WeRead 等）
protocol AutoSyncSourceProvider: AnyObject {
    /// 对应的同步来源标识
    var id: SyncSource { get }
    /// 控制该来源自动同步的 UserDefaults key（例如 `"autoSync.appleBooks"`）
    var autoSyncUserDefaultsKey: String { get }
    /// 自动同步的最小时间间隔（通常为 24 小时）
    var intervalSeconds: TimeInterval { get }

    /// 定时触发的增量同步入口：
    /// - 会检查 autoSync 开关
    /// - 会根据 `intervalSeconds` 过滤近期开过的任务
    func triggerScheduledSyncIfEnabled()

    /// 显式触发一次同步入口：
    /// - 为保持与既有行为一致，同样尊重 autoSync 开关与最近同步时间
    func triggerManualSyncNow()
}
