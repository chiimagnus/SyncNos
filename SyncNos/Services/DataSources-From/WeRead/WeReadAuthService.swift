import Foundation

/// WeRead 认证服务：管理 Cookie 字符串的安全存储与读取
final class WeReadAuthService: WeReadAuthServiceProtocol {
    private let keychainKey = "WeReadCookieHeader"
    private let logger = DIContainer.shared.loggerService

    private var cachedHeader: String?

    init() {
        cachedHeader = loadCookieHeaderFromKeychain()
    }

    var isLoggedIn: Bool {
        if let header = cookieHeader {
            return !header.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return false
    }

    var cookieHeader: String? {
        cachedHeader
    }

    func updateCookieHeader(_ header: String) {
        let normalized = header.trimmingCharacters(in: .whitespacesAndNewlines)
        cachedHeader = normalized.isEmpty ? nil : normalized
        saveCookieHeaderToKeychain(normalized)
    }

    func clearCookies() {
        cachedHeader = nil
        removeCookieHeaderFromKeychain()
        logger.info("[WeRead] Cookie header cleared from Keychain.")
    }

    // MARK: - Keychain helpers

    private func saveCookieHeaderToKeychain(_ header: String) {
        guard let data = header.data(using: .utf8) else { return }
        let ok = KeychainHelper.shared.save(service: "SyncNos.WeRead", account: keychainKey, data: data)
        if !ok {
            logger.warning("[WeRead] Failed to store cookie header in Keychain.")
        }
    }

    private func loadCookieHeaderFromKeychain() -> String? {
        if let data = KeychainHelper.shared.read(service: "SyncNos.WeRead", account: keychainKey) {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }

    private func removeCookieHeaderFromKeychain() {
        _ = KeychainHelper.shared.delete(service: "SyncNos.WeRead", account: keychainKey)
    }
}
