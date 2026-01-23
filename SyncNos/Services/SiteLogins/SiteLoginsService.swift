import Foundation

// MARK: - Site Logins Service

/// 聚合所有数据源的登录信息（统一 cookieHeader 抽象）
actor SiteLoginsService: SiteLoginsServiceProtocol {
    private let providers: [any SiteLoginProviderProtocol]
    
    init(providers: [any SiteLoginProviderProtocol]) {
        self.providers = providers
    }
    
    func listAllEntries() async -> [SiteLoginEntry] {
        var all: [SiteLoginEntry] = []
        all.reserveCapacity(8)
        
        for provider in providers {
            let entries = await provider.listEntries()
            all.append(contentsOf: entries)
        }
        
        return all.sorted { lhs, rhs in
            if lhs.source != rhs.source {
                return lhs.source.rawValue < rhs.source.rawValue
            }
            return (lhs.domain ?? "") < (rhs.domain ?? "")
        }
    }
    
    func checkSession(entryId: String) async -> SiteLoginStatus {
        guard let provider = provider(for: entryId) else { return .unknown }
        return await provider.checkSession(entryId: entryId)
    }
    
    func clear(entryId: String) async {
        guard let provider = provider(for: entryId) else { return }
        await provider.clear(entryId: entryId)
    }
    
    func clearAll() async {
        for provider in providers {
            await provider.clearAll()
        }
    }
    
    // MARK: - Helpers
    
    private func provider(for entryId: String) -> (any SiteLoginProviderProtocol)? {
        let parts = entryId.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true)
        guard let first = parts.first else { return nil }
        guard let source = ContentSource(rawValue: String(first)) else { return nil }
        return providers.first { $0.source == source }
    }
}

