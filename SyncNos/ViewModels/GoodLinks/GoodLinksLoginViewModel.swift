import Foundation

@MainActor
final class GoodLinksLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var statusMessage: String?
    @Published var domainSummaries: [GoodLinksAuthDomainSummary] = []
    
    private let authService: GoodLinksAuthServiceProtocol
    
    init(authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService) {
        self.authService = authService
        refreshState()
    }
    
    func refreshState() {
        Task {
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            domainSummaries = await authService.getDomainSummaries()
            statusMessage = loggedIn ? String(localized: "Login detected.") : String(localized: "Please log in via the web view.")
        }
    }
    
    func saveCookies(_ cookies: [HTTPCookie]) {
        Task {
            await authService.updateCookies(cookies)
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            domainSummaries = await authService.getDomainSummaries()
            statusMessage = loggedIn ? String(localized: "Cookie saved successfully.") : String(localized: "Cookie is empty or invalid. Please log in first.")
        }
    }
    
    func logout() async {
        await authService.clearCookies()
        let loggedIn = await authService.isLoggedIn
        isLoggedIn = loggedIn
        domainSummaries = await authService.getDomainSummaries()
        statusMessage = String(localized: "Logged Out")
    }
    
    func clearDomain(_ domain: String) {
        Task {
            await authService.clearCookies(forDomain: domain)
            isLoggedIn = await authService.isLoggedIn
            domainSummaries = await authService.getDomainSummaries()
        }
    }
}
