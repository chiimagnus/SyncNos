import Foundation

/// Apple Books 同步服务对外协议
protocol AppleBooksSyncServiceProtocol: AnyObject {
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws
}
