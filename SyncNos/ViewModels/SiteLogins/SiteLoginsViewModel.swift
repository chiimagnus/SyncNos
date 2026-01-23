import Foundation

// MARK: - Site Logins ViewModel

@MainActor
final class SiteLoginsViewModel: ObservableObject {
    @Published var entries: [SiteLoginEntry] = []
    @Published var statusOverrides: [String: SiteLoginStatus] = [:]
    @Published var isLoading: Bool = false
    
    private let service: SiteLoginsServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        service: SiteLoginsServiceProtocol = DIContainer.shared.siteLoginsService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.service = service
        self.logger = logger
    }
    
    func refresh() {
        Task {
            await refreshInternal()
        }
    }
    
    func status(for entry: SiteLoginEntry) -> SiteLoginStatus {
        statusOverrides[entry.id] ?? entry.status
    }
    
    func checkSession(for entry: SiteLoginEntry) {
        Task {
            let status = await service.checkSession(entryId: entry.id)
            statusOverrides[entry.id] = status
        }
    }
    
    func clear(_ entry: SiteLoginEntry) {
        Task {
            await service.clear(entryId: entry.id)
            statusOverrides.removeValue(forKey: entry.id)
            await refreshInternal()
        }
    }
    
    func clearAll() {
        Task {
            await service.clearAll()
            statusOverrides.removeAll()
            await refreshInternal()
        }
    }
    
    // MARK: - Internal
    
    private func refreshInternal() async {
        isLoading = true
        defer { isLoading = false }
        entries = await service.listAllEntries()
    }
}
