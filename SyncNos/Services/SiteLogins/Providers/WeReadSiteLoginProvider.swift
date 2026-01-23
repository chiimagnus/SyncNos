import Foundation

// MARK: - WeRead Site Login Provider

actor WeReadSiteLoginProvider: SiteLoginProviderProtocol {
    nonisolated let source: ContentSource = .weRead
    
    private let authService: WeReadAuthServiceProtocol
    private let apiService: WeReadAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    init(
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
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
                source: .weRead,
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
            _ = try await apiService.fetchNotebooks()
            return .valid
        } catch let error as WeReadAPIError {
            switch error {
            case .notLoggedIn:
                return .needLogin(reason: "Not logged in")
            case .unauthorized:
                return .expired(reason: "Unauthorized")
            case .sessionExpired:
                return .expired(reason: "Session expired")
            case .sessionExpiredWithRefreshFailure(let reason):
                return .expired(reason: reason)
            case .rateLimited:
                logger.warning("[SiteLogins][WeRead] Rate limited during checkSession")
                return .unknown
            case .invalidResponse, .httpError, .apiError:
                logger.warning("[SiteLogins][WeRead] checkSession failed: \(error.localizedDescription)")
                return .unknown
            }
        } catch {
            logger.warning("[SiteLogins][WeRead] checkSession failed: \(error.localizedDescription)")
            return .unknown
        }
    }

    func cookieHeader(for url: String) async -> String? {
        guard let host = URL(string: url)?.host?.lowercased() else { return nil }
        if host == "weread.qq.com" || host.hasSuffix(".weread.qq.com") {
            return authService.cookieHeader
        }
        if host == "i.weread.qq.com" || host.hasSuffix(".i.weread.qq.com") {
            return authService.cookieHeader
        }
        return nil
    }
    
    func clear(entryId: String) async {
        guard entryId == source.rawValue else { return }
        await authService.clearCookies()
    }
    
    func clearAll() async {
        await authService.clearCookies()
    }
}
