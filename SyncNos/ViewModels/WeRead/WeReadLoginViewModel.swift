import Foundation

@MainActor
final class WeReadLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var statusMessage: String?
    @Published var manualCookie: String = ""

    private let authService: WeReadAuthServiceProtocol

    init(authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService) {
        self.authService = authService
        refreshState()
    }

    func refreshState() {
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = String(localized: "Login detected.", table: "Common")
        } else {
            statusMessage = String(localized: "Please log in via the web view.", table: "Common")
        }
    }

    func saveCookieHeader(_ header: String) {
        authService.updateCookieHeader(header)
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = String(localized: "Cookie saved successfully.", table: "Common")
        } else {
            statusMessage = String(localized: "Cookie is empty or invalid. Please log in first.", table: "Common")
        }
    }

    func applyManualCookie() {
        let trimmed = manualCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        saveCookieHeader(trimmed)
    }
}
