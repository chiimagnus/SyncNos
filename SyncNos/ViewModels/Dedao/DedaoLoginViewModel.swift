import Foundation

@MainActor
final class DedaoLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var statusMessage: String?
    @Published var manualCookie: String = ""

    private let authService: DedaoAuthServiceProtocol
    private let apiService: DedaoAPIServiceProtocol

    init(
        authService: DedaoAuthServiceProtocol,
        apiService: DedaoAPIServiceProtocol
    ) {
        self.authService = authService
        self.apiService = apiService
        refreshState()
    }

    func refreshState() {
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = NSLocalizedString("Dedao login detected.", comment: "")
        } else {
            statusMessage = NSLocalizedString("Please login to Dedao in the web view.", comment: "")
        }
    }

    func saveCookieHeader(_ header: String) {
        authService.updateCookieHeader(header)
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = NSLocalizedString("Cookie saved successfully.", comment: "")
        } else {
            statusMessage = NSLocalizedString("Cookie is empty or invalid. Please login first.", comment: "")
        }
    }

    func applyManualCookie() {
        let trimmed = manualCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        saveCookieHeader(trimmed)
    }

    func logout() async {
        await authService.clearCookies()
        isLoggedIn = false
        statusMessage = NSLocalizedString("Logged out.", comment: "")
    }
}
