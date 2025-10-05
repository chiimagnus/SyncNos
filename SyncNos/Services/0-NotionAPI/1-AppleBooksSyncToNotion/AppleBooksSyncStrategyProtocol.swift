import Foundation

/// Apple Books 同步策略协议
protocol AppleBooksSyncStrategyProtocol {
    /// 同步指定书籍（支持全量或增量）
    /// - Parameters:
    ///   - book: 目标书籍
    ///   - dbPath: Apple Books 注释数据库路径
    ///   - incremental: 是否执行增量同步
    ///   - progress: 进度回调
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws

    /// 智能同步（根据上次同步时间自动选择全量/增量）
    /// - Parameters:
    ///   - book: 目标书籍
    ///   - dbPath: Apple Books 注释数据库路径
    ///   - progress: 进度回调
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
}


