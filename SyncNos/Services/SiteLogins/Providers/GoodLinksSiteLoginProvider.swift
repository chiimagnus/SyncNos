import Foundation

// MARK: - GoodLinks Site Login Provider

actor GoodLinksSiteLoginProvider: SiteLoginProviderProtocol {
    nonisolated let source: ContentSource = .goodLinks
    
    private let authService: GoodLinksAuthServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.logger = logger
    }
    
    func listEntries() async -> [SiteLoginEntry] {
        let domains = await authService.listDomains()
        var result: [SiteLoginEntry] = []
        result.reserveCapacity(domains.count)
        
        for item in domains {
            let header = await authService.getCookieHeader(for: "https://\(item.domain)/")
            result.append(
                SiteLoginEntry(
                    source: .goodLinks,
                    domain: item.domain,
                    status: .unknown,
                    cookieHeader: header,
                    updatedAt: item.updatedAt
                )
            )
        }
        
        return result
    }
    
    func checkSession(entryId: String) async -> SiteLoginStatus {
        guard let domain = parseDomain(from: entryId) else { return .unknown }
        let header = await authService.getCookieHeader(for: "https://\(domain)/")
        if let header, !header.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .unknown
        }
        return .needLogin(reason: "No cookieHeader")
    }
    
    func clear(entryId: String) async {
        guard let domain = parseDomain(from: entryId) else { return }
        await authService.clearCookies(forDomain: domain)
        logger.info("[SiteLogins][GoodLinks] Cleared domain=\(domain)")
    }
    
    func clearAll() async {
        await authService.clearCookies()
        logger.info("[SiteLogins][GoodLinks] Cleared all domains")
    }
    
    // MARK: - Helpers
    
    private func parseDomain(from entryId: String) -> String? {
        let parts = entryId.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true)
        guard parts.count == 2 else { return nil }
        guard parts[0] == Substring(source.rawValue) else { return nil }
        let domain = String(parts[1])
        return domain.isEmpty ? nil : domain
    }
}

