import Foundation

// MARK: - Protocol
protocol NotionSyncCoordinatorProtocol: AnyObject {
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws
}

// MARK: - Implementation
final class NotionSyncCoordinator: NotionSyncCoordinatorProtocol {
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.config = config
    }

    // MARK: - Public API
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        let mode = config.syncMode ?? "single"
        let strategy = createSyncStrategy(for: mode)
        try await strategy.syncSmart(book: book, dbPath: dbPath, progress: progress)
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        let mode = config.syncMode ?? "single"
        let strategy = createSyncStrategy(for: mode)
        try await strategy.sync(book: book, dbPath: dbPath, incremental: incremental, progress: progress)
    }

    // MARK: - Strategy Creation
    private func createSyncStrategy(for mode: String) -> SyncStrategyProtocol {
        switch mode {
        case "perBook":
            return SyncStrategyPerBook(
                databaseService: databaseService,
                notionService: notionService,
                config: config
            )
        default: // Default to "single"
            return SyncStrategySingleDB(
                databaseService: databaseService,
                notionService: notionService,
                config: config
            )
        }
    }
}
