import Foundation

/// Apple Books 同步服务实现（Facade）
final class AppleBooksSyncService: AppleBooksSyncServiceProtocol {
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

    private func makeStrategy() -> AppleBooksSyncStrategyProtocol {
        let mode = config.syncMode ?? "single"
        switch mode {
        case "perBook":
            return AppleBooksSyncStrategyPerBook(databaseService: databaseService, notionService: notionService, config: config)
        default:
            return AppleBooksSyncStrategySingleDB(databaseService: databaseService, notionService: notionService, config: config)
        }
    }

    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        try await makeStrategy().syncSmart(book: book, dbPath: dbPath, progress: progress)
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        try await makeStrategy().sync(book: book, dbPath: dbPath, incremental: incremental, progress: progress)
    }
}


