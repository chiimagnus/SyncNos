import Foundation

/// 抽象单个数据源的自动同步逻辑，便于按源扩展（Apple Books / GoodLinks / WeRead 等）
/// 
/// 智能增量同步：只同步有变更的内容，通过比较「内容修改时间」与「上次同步时间」判断
protocol AutoSyncSourceProvider: AnyObject {
    /// 对应的同步来源标识
    var id: SyncSource { get }
    /// 控制该来源自动同步的 UserDefaults key（例如 `"autoSync.appleBooks"`）
    var autoSyncUserDefaultsKey: String { get }

    /// 定时触发的增量同步入口：
    /// - 会检查 autoSync 开关
    /// - 会智能判断哪些内容有变更需要同步
    func triggerScheduledSyncIfEnabled()

    /// 显式触发一次同步入口：
    /// - 为保持与既有行为一致，同样尊重 autoSync 开关
    func triggerManualSyncNow()
}
