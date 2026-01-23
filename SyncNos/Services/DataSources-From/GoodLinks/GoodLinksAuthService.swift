import Foundation
import WebKit

// MARK: - Domain Summary

struct GoodLinksAuthDomainSummary: Identifiable, Sendable, Equatable {
    var id: String { domain }
    let domain: String
    let cookieCount: Int
    let earliestExpiry: Date?
    let hasSessionCookies: Bool
}

/// GoodLinks 认证服务：管理 WebKit cookies 的安全存储与读取（用于需要登录的网站）
///
/// 注意：
/// - 采用延迟加载策略，只有在真正访问 `isLoggedIn` / `getCookieHeader(for:)` 时才会读取 Keychain，
///   避免在应用启动时触发 Keychain 权限弹窗。
/// - 由于 GoodLinks 可能用于任意网站，清理 WebKit cookies 时只删除“本服务已保存的 cookie 域名”对应的 cookies，
///   避免误删其他数据源的登录状态。
actor GoodLinksAuthService: GoodLinksAuthServiceProtocol {
    private let keychainKey = "GoodLinksStoredCookiesV1"
    private let logger = DIContainer.shared.loggerService
    
    private var cachedCookies: [StoredCookie] = []
    private var hasLoadedFromKeychain = false
    
    init() {
        // 延迟加载：不在初始化时读取 Keychain
    }
    
    var isLoggedIn: Bool {
        ensureLoadedFromKeychain()
        return !validCookies(forHost: nil).isEmpty
    }
    
    func updateCookies(_ cookies: [HTTPCookie]) {
        ensureLoadedFromKeychain()
        let stored = cookies.compactMap(StoredCookie.init(cookie:))
        cachedCookies = mergeCookies(existing: cachedCookies, incoming: stored)
        hasLoadedFromKeychain = true
        saveCookiesToKeychain(cachedCookies)
        logger.info("[GoodLinksAuth] Saved cookies count=\(cachedCookies.count)")
    }
    
    func getCookieHeader(for url: String) -> String? {
        ensureLoadedFromKeychain()
        guard let u = URL(string: url), let host = u.host, !host.isEmpty else { return nil }
        let applicable = validCookies(forHost: host)
        guard !applicable.isEmpty else { return nil }
        return applicable
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }
    
    func getDomainSummaries() -> [GoodLinksAuthDomainSummary] {
        ensureLoadedFromKeychain()
        
        let now = Date()
        let valid = cachedCookies.filter { cookie in
            if let exp = cookie.expiresAt, exp <= now { return false }
            return true
        }
        
        let grouped = Dictionary(grouping: valid) { cookie in
            Self.normalizeDomain(cookie.domain)
        }
        
        let summaries: [GoodLinksAuthDomainSummary] = grouped.compactMap { (domain, items) in
            let d = domain.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !d.isEmpty else { return nil }
            
            let expiries = items.compactMap { $0.expiresAt }
            let earliestExpiry = expiries.min()
            let hasSessionCookies = items.contains { $0.expiresAt == nil }
            
            return GoodLinksAuthDomainSummary(
                domain: d,
                cookieCount: items.count,
                earliestExpiry: earliestExpiry,
                hasSessionCookies: hasSessionCookies
            )
        }
        
        return summaries.sorted { $0.domain < $1.domain }
    }
    
    func clearCookies(forDomain domain: String) async {
        ensureLoadedFromKeychain()
        let d = Self.normalizeDomain(domain)
        guard !d.isEmpty else { return }
        
        cachedCookies.removeAll { Self.normalizeDomain($0.domain) == d || Self.normalizeDomain($0.domain).hasSuffix("." + d) }
        hasLoadedFromKeychain = true
        saveCookiesToKeychain(cachedCookies)
        
        await clearWebKitCookies(domains: [d])
        logger.info("[GoodLinksAuth] Cleared cookies for domain=\(d)")
    }
    
    func clearCookies() async {
        ensureLoadedFromKeychain()
        let domainsToClear = Set(cachedCookies.map { Self.normalizeDomain($0.domain) }.filter { !$0.isEmpty })
        cachedCookies = []
        hasLoadedFromKeychain = true
        removeCookiesFromKeychain()
        await clearWebKitCookies(domains: domainsToClear)
        logger.info("[GoodLinksAuth] Cookies cleared from Keychain and WebKit.")
    }
    
    // MARK: - Stored Cookie
    
    private struct StoredCookie: Codable {
        let name: String
        let value: String
        let domain: String
        let path: String
        let expiresAt: Date?
        let isSecure: Bool
        let isHTTPOnly: Bool
        
        init?(cookie: HTTPCookie) {
            guard !cookie.name.isEmpty else { return nil }
            guard !cookie.value.isEmpty else { return nil }
            guard !cookie.domain.isEmpty else { return nil }
            
            self.name = cookie.name
            self.value = cookie.value
            self.domain = cookie.domain
            self.path = cookie.path
            self.expiresAt = cookie.expiresDate
            self.isSecure = cookie.isSecure
            self.isHTTPOnly = cookie.isHTTPOnly
        }
    }
    
    // MARK: - Lazy Load
    
    private func ensureLoadedFromKeychain() {
        guard !hasLoadedFromKeychain else { return }
        cachedCookies = loadCookiesFromKeychain() ?? []
        hasLoadedFromKeychain = true
    }
    
    // MARK: - Cookie Selection
    
    private func validCookies(forHost host: String?) -> [StoredCookie] {
        let now = Date()
        return cachedCookies.filter { cookie in
            if let exp = cookie.expiresAt, exp <= now { return false }
            if let host {
                return Self.domainMatches(host: host, cookieDomain: cookie.domain)
            }
            return true
        }
    }
    
    private static func domainMatches(host: String, cookieDomain: String) -> Bool {
        let h = host.lowercased()
        let d = normalizeDomain(cookieDomain)
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
    
    private func mergeCookies(existing: [StoredCookie], incoming: [StoredCookie]) -> [StoredCookie] {
        var dict: [String: StoredCookie] = [:]
        for c in existing {
            dict[cookieKey(c)] = c
        }
        for c in incoming {
            dict[cookieKey(c)] = c
        }
        
        let merged = Array(dict.values)
        // 清理已过期的 cookies，避免越积越多
        let now = Date()
        return merged.filter { cookie in
            if let exp = cookie.expiresAt, exp <= now { return false }
            return true
        }
    }
    
    private func cookieKey(_ cookie: StoredCookie) -> String {
        "\(cookie.name)|\(Self.normalizeDomain(cookie.domain))|\(cookie.path)"
    }
    
    private func deduplicate(_ cookies: [StoredCookie]) -> [StoredCookie] {
        var seen = Set<String>()
        var result: [StoredCookie] = []
        for c in cookies {
            let key = "\(c.name)|\(Self.normalizeDomain(c.domain))|\(c.path)"
            if seen.contains(key) { continue }
            seen.insert(key)
            result.append(c)
        }
        return result
    }
    
    // MARK: - Keychain helpers
    
    private func saveCookiesToKeychain(_ cookies: [StoredCookie]) {
        guard let data = try? JSONEncoder().encode(cookies) else { return }
        let ok = KeychainHelper.shared.save(service: "SyncNos.GoodLinks", account: keychainKey, data: data)
        if !ok {
            logger.warning("[GoodLinksAuth] Failed to store cookies in Keychain.")
        }
    }
    
    private func loadCookiesFromKeychain() -> [StoredCookie]? {
        guard let data = KeychainHelper.shared.read(service: "SyncNos.GoodLinks", account: keychainKey) else { return nil }
        return try? JSONDecoder().decode([StoredCookie].self, from: data)
    }
    
    private func removeCookiesFromKeychain() {
        _ = KeychainHelper.shared.delete(service: "SyncNos.GoodLinks", account: keychainKey)
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
