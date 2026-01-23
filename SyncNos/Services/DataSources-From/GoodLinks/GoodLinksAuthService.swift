import Foundation
import WebKit

// MARK: - Domain Entry

struct GoodLinksAuthDomainEntry: Identifiable, Sendable, Equatable {
    var id: String { domain }
    let domain: String
    let updatedAt: Date
}

/// GoodLinks 认证服务：管理 WebKit cookies 的安全存储与读取（用于需要登录的网站）
///
/// 注意：
/// - 采用延迟加载策略，只有在真正访问 `isLoggedIn` / `getCookieHeader(for:)` 时才会读取 Keychain，
///   避免在应用启动时触发 Keychain 权限弹窗。
/// - 由于 GoodLinks 可能用于任意网站，清理 WebKit cookies 时只删除“本服务已保存的 domain”对应的 cookies，
///   避免误删其他数据源的登录状态。
actor GoodLinksAuthService: GoodLinksAuthServiceProtocol {
    private let keychainKeyV2 = "GoodLinksCookieHeaderByDomainV2"
    private let legacyKeychainKeyV1 = "GoodLinksStoredCookiesV1"
    private let logger = DIContainer.shared.loggerService
    
    private var cachedDomainCookies: [StoredDomainCookie] = []
    private var hasLoadedFromKeychain = false
    
    init() {
        // 延迟加载：不在初始化时读取 Keychain
    }
    
    var isLoggedIn: Bool {
        ensureLoadedFromKeychain()
        return cachedDomainCookies.contains { !$0.cookieHeader.isEmpty }
    }
    
    func upsertCookieHeader(_ cookieHeader: String, forDomain domain: String) {
        ensureLoadedFromKeychain()
        
        let d = Self.normalizeDomain(domain)
        guard !d.isEmpty else { return }
        
        let header = cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines)
        if header.isEmpty {
            cachedDomainCookies.removeAll { $0.domain == d }
            hasLoadedFromKeychain = true
            saveDomainCookiesToKeychain(cachedDomainCookies)
            logger.info("[GoodLinksAuth] Removed cookieHeader for domain=\(d)")
            return
        }
        
        if let index = cachedDomainCookies.firstIndex(where: { $0.domain == d }) {
            cachedDomainCookies[index] = StoredDomainCookie(domain: d, cookieHeader: header, updatedAt: Date())
        } else {
            cachedDomainCookies.append(StoredDomainCookie(domain: d, cookieHeader: header, updatedAt: Date()))
        }
        
        hasLoadedFromKeychain = true
        saveDomainCookiesToKeychain(cachedDomainCookies)
        logger.info("[GoodLinksAuth] Saved cookieHeader domain=\(d)")
    }
    
    func getCookieHeader(for url: String) -> String? {
        ensureLoadedFromKeychain()
        guard let u = URL(string: url), let host = u.host, !host.isEmpty else { return nil }
        
        let h = host.lowercased()
        let candidates = cachedDomainCookies
            .filter { Self.domainMatches(host: h, domain: $0.domain) && !$0.cookieHeader.isEmpty }
            .sorted { $0.domain.count > $1.domain.count }
        
        return candidates.first?.cookieHeader
    }
    
    func listDomains() -> [GoodLinksAuthDomainEntry] {
        ensureLoadedFromKeychain()
        
        return cachedDomainCookies
            .filter { !$0.domain.isEmpty }
            .sorted { $0.domain < $1.domain }
            .map { GoodLinksAuthDomainEntry(domain: $0.domain, updatedAt: $0.updatedAt) }
    }
    
    func clearCookies(forDomain domain: String) async {
        ensureLoadedFromKeychain()
        let d = Self.normalizeDomain(domain)
        guard !d.isEmpty else { return }
        
        cachedDomainCookies.removeAll { $0.domain == d }
        hasLoadedFromKeychain = true
        saveDomainCookiesToKeychain(cachedDomainCookies)
        
        await clearWebKitCookies(domains: [d])
        logger.info("[GoodLinksAuth] Cleared cookies for domain=\(d)")
    }
    
    func clearCookies() async {
        ensureLoadedFromKeychain()
        let domainsToClear = Set(cachedDomainCookies.map { $0.domain }.filter { !$0.isEmpty })
        cachedDomainCookies = []
        hasLoadedFromKeychain = true
        removeCookiesFromKeychain()
        await clearWebKitCookies(domains: domainsToClear)
        logger.info("[GoodLinksAuth] Cookies cleared from Keychain and WebKit.")
    }
    
    // MARK: - Stored Domain Cookie
    
    private struct StoredDomainCookie: Codable {
        let domain: String
        let cookieHeader: String
        let updatedAt: Date
    }
    
    // MARK: - Lazy Load
    
    private func ensureLoadedFromKeychain() {
        guard !hasLoadedFromKeychain else { return }
        cachedDomainCookies = loadDomainCookiesFromKeychain() ?? []
        
        // 破坏性：不迁移旧格式，直接废弃旧 Keychain entry（避免后续困惑）
        if KeychainHelper.shared.read(service: "SyncNos.GoodLinks", account: legacyKeychainKeyV1) != nil {
            _ = KeychainHelper.shared.delete(service: "SyncNos.GoodLinks", account: legacyKeychainKeyV1)
        }
        
        hasLoadedFromKeychain = true
    }
    
    // MARK: - Domain Matching
    
    private static func domainMatches(host: String, domain: String) -> Bool {
        let h = host.lowercased()
        let d = normalizeDomain(domain)
        guard !h.isEmpty, !d.isEmpty else { return false }
        if h == d { return true }
        return h.hasSuffix("." + d)
    }
    
    private static func normalizeDomain(_ domain: String) -> String {
        domain
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
    
    // MARK: - Keychain helpers
    
    private func saveDomainCookiesToKeychain(_ cookies: [StoredDomainCookie]) {
        guard let data = try? JSONEncoder().encode(cookies) else { return }
        let ok = KeychainHelper.shared.save(service: "SyncNos.GoodLinks", account: keychainKeyV2, data: data)
        if !ok {
            logger.warning("[GoodLinksAuth] Failed to store cookies in Keychain.")
        }
    }
    
    private func loadDomainCookiesFromKeychain() -> [StoredDomainCookie]? {
        guard let data = KeychainHelper.shared.read(service: "SyncNos.GoodLinks", account: keychainKeyV2) else { return nil }
        return try? JSONDecoder().decode([StoredDomainCookie].self, from: data)
    }
    
    private func removeCookiesFromKeychain() {
        _ = KeychainHelper.shared.delete(service: "SyncNos.GoodLinks", account: keychainKeyV2)
    }
    
    // MARK: - WebKit Cookie helpers
    
    @MainActor
    private func clearWebKitCookies(domains: Set<String>) async {
        guard !domains.isEmpty else { return }
        let store = WKWebsiteDataStore.default()
        
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.httpCookieStore.getAllCookies { cookies in
                let targets = cookies.filter { cookie in
                    let d = Self.normalizeDomain(cookie.domain)
                    for target in domains {
                        if d == target || d.hasSuffix("." + target) { return true }
                    }
                    return false
                }
                
                let group = DispatchGroup()
                for cookie in targets {
                    group.enter()
                    store.httpCookieStore.delete(cookie) {
                        group.leave()
                    }
                }
                
                group.notify(queue: .main) {
                    self.logger.info("[GoodLinksAuth] Cleared \(targets.count) WebKit cookies.")
                    continuation.resume()
                }
            }
        }
    }
}
