import Foundation

// MARK: - Dedao Site Login Provider

actor DedaoSiteLoginProvider: SiteLoginProviderProtocol {
    nonisolated let source: ContentSource = .dedao
    
    private let authService: DedaoAuthServiceProtocol
    private let apiService: DedaoAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        authService: DedaoAuthServiceProtocol = DIContainer.shared.dedaoAuthService,
        apiService: DedaoAPIServiceProtocol = DIContainer.shared.dedaoAPIService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.apiService = apiService
        self.logger = logger
    }
    
    func listEntries() async -> [SiteLoginEntry] {
        let status: SiteLoginStatus = authService.isLoggedIn
            ? .unknown
            : .needLogin(reason: "No cookieHeader")
        
        return [
            SiteLoginEntry(
                source: .dedao,
                status: status,
                cookieHeader: authService.cookieHeader,
                updatedAt: nil
            )
        ]
    }
    
    func checkSession(entryId: String) async -> SiteLoginStatus {
        guard entryId == source.rawValue else { return .unknown }
        guard authService.isLoggedIn else { return .needLogin(reason: "Not logged in") }
        
        do {
            _ = try await apiService.fetchUserInfo()
            return .valid
        } catch let error as DedaoAPIError {
            switch error {
            case .notLoggedIn:
                return .needLogin(reason: "Not logged in")
            case .sessionExpired:
                return .expired(reason: "Session expired")
            case .needVerification:
                return .needVerification(reason: "Need verification")
            case .rateLimited:
                logger.warning("[SiteLogins][Dedao] Rate limited during checkSession")
                return .unknown
            case .invalidResponse, .serverError, .networkError, .qrCodeExpired:
                logger.warning("[SiteLogins][Dedao] checkSession failed: \(error.localizedDescription)")
                return .unknown
            }
        } catch {
            logger.warning("[SiteLogins][Dedao] checkSession failed: \(error.localizedDescription)")
            return .unknown
        }
    }
    
    func clear(entryId: String) async {
        guard entryId == source.rawValue else { return }
        await authService.clearCookies()
    }
    
    func clearAll() async {
        await authService.clearCookies()
    }
}
