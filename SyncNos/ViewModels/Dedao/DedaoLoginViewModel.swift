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
            statusMessage = String(localized: "Login detected.")
        } else {
            statusMessage = String(localized: "Please log in via the web view.")
        }
    }

    func saveCookieHeader(_ header: String) {
        authService.updateCookieHeader(header)
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = String(localized: "Cookie saved successfully.")
        } else {
            statusMessage = String(localized: "Cookie is empty or invalid. Please log in first.")
        }
    }

    func applyManualCookie() {
        let trimmed = manualCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        saveCookieHeader(trimmed)
    }

    func logout() async {
        await authService.clearCookies()
        isLoggedIn = false
        statusMessage = String(localized: "Logged Out")
    }
}
