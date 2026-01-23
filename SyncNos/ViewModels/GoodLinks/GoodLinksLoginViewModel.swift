import Foundation

@MainActor
final class GoodLinksLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var statusMessage: String?
    
    private let authService: GoodLinksAuthServiceProtocol
    
    init(authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService) {
        self.authService = authService
        refreshState()
    }
    
    func refreshState() {
        Task {
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            statusMessage = loggedIn ? String(localized: "Login detected.") : String(localized: "Please log in via the web view.")
        }
    }
    
    func saveCookies(_ cookies: [HTTPCookie]) {
        Task {
            await authService.updateCookies(cookies)
            let loggedIn = await authService.isLoggedIn
            isLoggedIn = loggedIn
            statusMessage = loggedIn ? String(localized: "Cookie saved successfully.") : String(localized: "Cookie is empty or invalid. Please log in first.")
        }
    }
    
    func logout() async {
        await authService.clearCookies()
        let loggedIn = await authService.isLoggedIn
        isLoggedIn = loggedIn
        statusMessage = String(localized: "Logged Out")
    }
}
