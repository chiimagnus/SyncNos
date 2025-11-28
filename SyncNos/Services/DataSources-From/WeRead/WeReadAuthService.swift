import Foundation
import WebKit

/// WeRead 认证服务：管理 Cookie 字符串的安全存储与读取
/// 
/// 注意：采用延迟加载策略，只有在真正访问 `cookieHeader` 或 `isLoggedIn` 时才会读取 Keychain，
/// 避免在应用启动时触发 Keychain 权限弹窗（尤其是用户未启用 WeRead 数据源的情况下）。
final class WeReadAuthService: WeReadAuthServiceProtocol {
    private let keychainKey = "WeReadCookieHeader"
    private let logger = DIContainer.shared.loggerService

    /// 缓存的 Cookie Header
    private var cachedHeader: String?
    
    /// 标记是否已从 Keychain 加载过
    private var hasLoadedFromKeychain = false

    init() {
        // 延迟加载：不在初始化时读取 Keychain，避免触发权限弹窗
    }

    var isLoggedIn: Bool {
        if let header = cookieHeader {
            return !header.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return false
    }

    var cookieHeader: String? {
        ensureLoadedFromKeychain()
        return cachedHeader
    }
    
    /// 确保已从 Keychain 加载（延迟加载的核心逻辑）
    private func ensureLoadedFromKeychain() {
        guard !hasLoadedFromKeychain else { return }
        cachedHeader = loadCookieHeaderFromKeychain()
        hasLoadedFromKeychain = true
    }

    func updateCookieHeader(_ header: String) {
        let normalized = header.trimmingCharacters(in: .whitespacesAndNewlines)
        cachedHeader = normalized.isEmpty ? nil : normalized
        hasLoadedFromKeychain = true  // 标记已加载，避免下次访问时重复读取
        saveCookieHeaderToKeychain(normalized)
    }

    func clearCookies() async {
        cachedHeader = nil
        hasLoadedFromKeychain = true  // 标记已加载（清空也算一种加载状态）
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
