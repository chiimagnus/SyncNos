import Foundation

@MainActor
final class GoodLinksLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var statusMessage: String?
    @Published var domainEntries: [GoodLinksAuthDomainEntry] = []
    
    private let authService: GoodLinksAuthServiceProtocol
    
    init(authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService) {
        self.authService = authService
        refreshState()
    }
    
    func refreshState() {
        Task {
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            domainEntries = await authService.listDomains()
            statusMessage = loggedIn ? String(localized: "Login detected.") : String(localized: "Please log in via the web view.")
        }
    }
    
    func saveCookies(_ cookies: [HTTPCookie], host: String) {
        Task {
            let headerFields = HTTPCookie.requestHeaderFields(with: cookies)
            let cookieHeader = headerFields["Cookie"] ?? ""
            let storageDomain = computeStorageDomain(host: host, cookies: cookies)
            await authService.upsertCookieHeader(cookieHeader, forDomain: storageDomain)
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            domainEntries = await authService.listDomains()
            statusMessage = loggedIn ? String(localized: "Cookie saved successfully.") : String(localized: "Cookie is empty or invalid. Please log in first.")
        }
    }
    
    func logout() async {
        await authService.clearCookies()
        let loggedIn = await authService.isLoggedIn
        isLoggedIn = loggedIn
        domainEntries = await authService.listDomains()
        statusMessage = String(localized: "Logged Out")
    }
    
    func clearDomain(_ domain: String) {
        Task {
            await authService.clearCookies(forDomain: domain)
            isLoggedIn = await authService.isLoggedIn
            domainEntries = await authService.listDomains()
        }
    }
    
    // MARK: - Helpers
    
    private func computeStorageDomain(host: String, cookies: [HTTPCookie]) -> String {
        let h = normalizeDomain(host)
        guard !h.isEmpty else { return host }
        
        let candidates = Set(cookies.map { normalizeDomain($0.domain) })
            .filter { !$0.isEmpty && domainMatches(host: h, domain: $0) }
            .sorted { $0.count < $1.count }
        
        return candidates.first ?? h
    }
    
    private func domainMatches(host: String, domain: String) -> Bool {
        let h = normalizeDomain(host)
        let d = normalizeDomain(domain)
        guard !h.isEmpty, !d.isEmpty else { return false }
        if h == d { return true }
        return h.hasSuffix("." + d)
    }
    
    private func normalizeDomain(_ domain: String) -> String {
        domain
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
}
