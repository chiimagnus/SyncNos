import Foundation

/// Protocol defining the interface for different synchronization strategies
protocol SyncStrategyProtocol {
    /// Synchronize a book using the specific strategy
    /// - Parameters:
    ///   - book: The book to sync
    ///   - dbPath: Path to the database
    ///   - incremental: Whether to perform incremental sync
    ///   - progress: Progress callback
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws

    /// Smart sync a book using the specific strategy
    /// - Parameters:
    ///   - book: The book to sync
    ///   - dbPath: Path to the database
    ///   - progress: Progress callback
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
}