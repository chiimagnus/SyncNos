import Foundation
import WebKit

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

    func clearCookies() async {
        cachedHeader = nil
        removeCookieHeaderFromKeychain()
        await clearWebKitCookies()
        logger.info("[WeRead] Cookie header cleared from Keychain and WebKit.")
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

    // MARK: - WebKit Cookie helpers

    @MainActor
    private func clearWebKitCookies() async {
        let store = WKWebsiteDataStore.default()
        
        // 使用 async/await 确保清理完成
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.httpCookieStore.getAllCookies { cookies in
                let wereadCookies = cookies.filter { cookie in
                    cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
                }
                
                // 同步删除所有 WeRead cookies
                let group = DispatchGroup()
                for cookie in wereadCookies {
                    group.enter()
                    store.httpCookieStore.delete(cookie) {
                        group.leave()
                    }
                }
                
                group.notify(queue: .main) {
                    Task { @MainActor in
                        self.logger.info("[WeRead] Cleared \(wereadCookies.count) WebKit cookies.")
                        continuation.resume()
                    }
                }
            }
        }
    }
}
