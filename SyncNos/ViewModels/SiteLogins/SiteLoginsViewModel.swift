import Foundation

// MARK: - Site Logins ViewModel

@MainActor
final class SiteLoginsViewModel: ObservableObject {
    @Published var domains: [SiteLoginsDomainEntry] = []
    @Published var isLoading: Bool = false
    
    private let store: SiteLoginsStoreProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        store: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.store = store
        self.logger = logger
    }
    
    func refresh() {
        Task {
            await refreshInternal()
        }
    }
    
    func clear(domain: String) {
        Task {
            await store.clear(domain: domain)
            await refreshInternal()
        }
    }
    
    func clearAll() {
        Task {
            await store.clearAll()
            await refreshInternal()
        }
    }
    
    // MARK: - Internal
    
    private func refreshInternal() async {
        isLoading = true
        defer { isLoading = false }
        domains = await store.listDomains()
        logger.debug("[SiteLoginsViewModel] Loaded domains=\(domains.count)")
    }
}
