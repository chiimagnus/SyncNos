import Foundation

/// 抽象单个数据源的自动预取（fetch）逻辑，便于按源扩展（当前仅 GoodLinks）。
///
/// 说明：
/// - 自动预取与 Notion 同步相互独立
/// - “完成”的口径以本地持久化缓存（SwiftData）是否命中为准
protocol AutoFetchSourceProvider: AnyObject {
    /// 对应的数据源标识
    var id: ContentSource { get }

    /// 定时触发的预取入口
    func triggerScheduledFetch()

    /// 显式触发一次预取入口
    func triggerManualFetchNow()
}

