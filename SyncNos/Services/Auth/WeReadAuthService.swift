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
        do {
            try saveCookieHeaderToKeychain(normalized)
            logger.info("[WeRead] Cookie header updated and stored in Keychain.")
        } catch {
            logger.error("[WeRead] Failed to store cookie header in Keychain: \(error.localizedDescription)")
        }
    }

    func clearCookies() {
        cachedHeader = nil
        do {
            try removeCookieHeaderFromKeychain()
            logger.info("[WeRead] Cookie header cleared from Keychain.")
        } catch {
            logger.error("[WeRead] Failed to clear cookie header from Keychain: \(error.localizedDescription)")
        }
    }

    // MARK: - Keychain helpers

    private func saveCookieHeaderToKeychain(_ header: String) throws {
        guard let data = header.data(using: .utf8) else { return }
        // 这里复用 KeychainHelper 中的通用存储逻辑以保持一致性
        try KeychainHelper.standard.save(data: data, service: "SyncNos.WeRead", account: keychainKey)
    }

    private func loadCookieHeaderFromKeychain() -> String? {
        do {
            if let data = try KeychainHelper.standard.read(service: "SyncNos.WeRead", account: keychainKey) {
                return String(data: data, encoding: .utf8)
            }
        } catch {
            logger.warning("[WeRead] Failed to read cookie header from Keychain: \(error.localizedDescription)")
        }
        return nil
    }

    private func removeCookieHeaderFromKeychain() throws {
        try KeychainHelper.standard.delete(service: "SyncNos.WeRead", account: keychainKey)
    }
}


