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
            statusMessage = NSLocalizedString("WeRead login detected.", comment: "")
        } else {
            statusMessage = NSLocalizedString("Please login to WeRead in the web view or paste cookie below.", comment: "")
        }
    }

    func saveCookieHeader(_ header: String) {
        authService.updateCookieHeader(header)
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = NSLocalizedString("Cookie saved successfully.", comment: "")
        } else {
            statusMessage = NSLocalizedString("Cookie is empty or invalid.", comment: "")
        }
    }

    func applyManualCookie() {
        let trimmed = manualCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        saveCookieHeader(trimmed)
    }
}


