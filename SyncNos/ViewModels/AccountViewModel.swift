import Foundation

final class AccountViewModel: ObservableObject {
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var profile: AccountProfile?
    @Published private(set) var loginMethods: [LoginMethod] = []

    // 持久化 key
    private let accessKey = "syncnos.access.token"
    private let refreshKey = "syncnos.refresh.token"
    private let keychain = KeychainHelper.shared
    private let auth: AuthServiceProtocol

    init(authService: AuthServiceProtocol = DIContainer.shared.authService) {
        self.auth = authService
    }

    // MARK: - Public Actions
    func load() {
        Task { await loadInternal() }
    }

    func loginWithApple(authorizationCode: String) {
        Task { await loginWithAppleInternal(code: authorizationCode) }
    }

    func logout() {
        Task { await logoutInternal() }
    }

    func deleteAccount() {
        Task { await deleteAccountInternal() }
    }

    // MARK: - Internals
    @MainActor
    private func setLoading(_ loading: Bool) { self.isLoading = loading }

    private func storedAccessToken() -> String? {
        keychain.read(service: accessKey, account: "syncnos")?.flatMap { String(data: $0, encoding: .utf8) }
    }

    private func storedRefreshToken() -> String? {
        keychain.read(service: refreshKey, account: "syncnos")?.flatMap { String(data: $0, encoding: .utf8) }
    }

    private func store(tokens: AuthTokens) {
        if let data = tokens.accessToken.data(using: .utf8) {
            _ = keychain.save(service: accessKey, account: "syncnos", data: data)
        }
        if let data = tokens.refreshToken.data(using: .utf8) {
            _ = keychain.save(service: refreshKey, account: "syncnos", data: data)
        }
    }

    private func clearTokens() {
        _ = keychain.delete(service: accessKey, account: "syncnos")
        _ = keychain.delete(service: refreshKey, account: "syncnos")
    }

    private func ensureAccessToken() async throws -> String {
        if let token = storedAccessToken() { return token }
        // 如果没有 access，尝试 refresh
        guard let refresh = storedRefreshToken() else {
            throw NSError(domain: "AccountVM", code: -1, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let tokens = try await auth.refresh(refreshToken: refresh)
        store(tokens: tokens)
        return tokens.accessToken
    }

    // MARK: - Async flows
    private func loadInternal() async {
        await setLoading(true)
        await MainActor.run { self.errorMessage = nil }
        do {
            let access = try await ensureAccessToken()
            async let p: AccountProfile = auth.fetchProfile(accessToken: access)
            async let m: [LoginMethod] = auth.fetchLoginMethods(accessToken: access)
            let (profile, methods) = try await (p, m)
            await MainActor.run {
                self.profile = profile
                self.loginMethods = methods
            }
        } catch {
            await MainActor.run { self.errorMessage = error.localizedDescription }
        }
        await setLoading(false)
    }

    private func loginWithAppleInternal(code: String) async {
        await setLoading(true)
        await MainActor.run { self.errorMessage = nil }
        do {
            let tokens = try await auth.loginWithApple(authorizationCode: code)
            store(tokens: tokens)
            try await Task.sleep(nanoseconds: 200_000_000)
            await loadInternal()
        } catch {
            await MainActor.run { self.errorMessage = error.localizedDescription }
        }
        await setLoading(false)
    }

    private func logoutInternal() async {
        await setLoading(true)
        await MainActor.run { self.errorMessage = nil }
        do {
            if let refresh = storedRefreshToken() {
                try await auth.logout(refreshToken: refresh)
            }
        } catch {
            // 忽略后端错误，继续清理
        }
        clearTokens()
        await MainActor.run {
            self.profile = nil
            self.loginMethods = []
        }
        await setLoading(false)
    }

    private func deleteAccountInternal() async {
        await setLoading(true)
        await MainActor.run { self.errorMessage = nil }
        do {
            let access = try await ensureAccessToken()
            try await auth.deleteAccount(accessToken: access)
            clearTokens()
            await MainActor.run {
                self.profile = nil
                self.loginMethods = []
            }
        } catch {
            await MainActor.run { self.errorMessage = error.localizedDescription }
        }
        await setLoading(false)
    }
}


