import Foundation
import WebKit

/// 统一站点登录存储：以 domain 为 key 存储 cookieHeader
///
/// 说明：
/// - 采用延迟加载策略：仅在真正访问列表/读取 Cookie 时读取 Keychain，避免启动时触发权限弹窗。
/// - 破坏性修改允许：首次加载时会尝试迁移旧 Keychain（如存在），并清理旧 entry。
actor SiteLoginsStore: SiteLoginsStoreProtocol {
    private let keychainService = "SyncNos.SiteLogins"
    private let keychainAccountV1 = "SiteLoginsCookieHeaderByDomainV1"
    private let logger = DIContainer.shared.loggerService

    // Legacy keys (best-effort migration, then delete)
    private let legacyWeReadService = "SyncNos.WeRead"
    private let legacyWeReadAccount = "WeReadCookieHeader"
    private let legacyDedaoService = "SyncNos.Dedao"
    private let legacyDedaoAccount = "DedaoCookieHeader"
    private let legacyGoodLinksService = "SyncNos.GoodLinks"
    private let legacyGoodLinksAccountV2 = "GoodLinksCookieHeaderByDomainV2"
    private let legacyGoodLinksAccountV1 = "GoodLinksStoredCookiesV1"

    private var cached: [StoredDomainCookie] = []
    private var hasLoadedFromKeychain = false

    init() {
        // 延迟加载：不在初始化时读取 Keychain
    }

    func upsertCookieHeader(_ cookieHeader: String, forDomain domain: String) async {
        await upsertCookieHeader(cookieHeader, forDomains: [domain])
    }

    func upsertCookieHeader(_ cookieHeader: String, forDomains domains: [String]) async {
        ensureLoadedFromKeychain()

        let normalizedHeader = cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedDomains = domains
            .map(Self.normalizeDomain)
            .filter { !$0.isEmpty }

        guard !normalizedDomains.isEmpty else { return }

        // empty header means delete
        if normalizedHeader.isEmpty {
            let toRemove = Set(normalizedDomains)
            cached.removeAll { toRemove.contains($0.domain) }
            saveToKeychain()
            return
        }

        var dict = Dictionary(uniqueKeysWithValues: cached.map { ($0.domain, $0) })
        let now = Date()
        for d in normalizedDomains {
            dict[d] = StoredDomainCookie(domain: d, cookieHeader: normalizedHeader, updatedAt: now)
        }
        cached = dict.values.sorted { $0.domain < $1.domain }
        saveToKeychain()
        logger.info("[SiteLoginsStore] Saved cookieHeader domains=\(normalizedDomains.joined(separator: ","))")
    }

    func getCookieHeader(for url: String) async -> String? {
        ensureLoadedFromKeychain()
        guard let u = URL(string: url), let host = u.host, !host.isEmpty else { return nil }

        let h = host.lowercased()
        let candidates = cached
            .filter { Self.domainMatches(host: h, domain: $0.domain) && !$0.cookieHeader.isEmpty }
            .sorted { $0.domain.count > $1.domain.count }

        return candidates.first?.cookieHeader
    }

    func listDomains() async -> [SiteLoginsDomainEntry] {
        ensureLoadedFromKeychain()
        return cached
            .filter { !$0.domain.isEmpty && !$0.cookieHeader.isEmpty }
            .sorted { $0.domain < $1.domain }
            .map { SiteLoginsDomainEntry(domain: $0.domain, cookieHeader: $0.cookieHeader, updatedAt: $0.updatedAt) }
    }

    func clear(domain: String) async {
        ensureLoadedFromKeychain()
        let d = Self.normalizeDomain(domain)
        guard !d.isEmpty else { return }

        cached.removeAll { $0.domain == d }
        saveToKeychain()
        await clearWebKitCookies(domains: [d])
        logger.info("[SiteLoginsStore] Cleared domain=\(d)")
    }

    func clear(domains: [String]) async {
        ensureLoadedFromKeychain()
        let normalized = Set(domains.map(Self.normalizeDomain).filter { !$0.isEmpty })
        guard !normalized.isEmpty else { return }

        cached.removeAll { normalized.contains($0.domain) }
        saveToKeychain()
        await clearWebKitCookies(domains: normalized)
        logger.info("[SiteLoginsStore] Cleared domains=\(normalized.sorted().joined(separator: ","))")
    }

    func clearAll() async {
        ensureLoadedFromKeychain()
        let domainsToClear = Set(cached.map { $0.domain }.filter { !$0.isEmpty })
        cached = []
        removeFromKeychain()
        await clearWebKitCookies(domains: domainsToClear)
        logger.info("[SiteLoginsStore] Cleared all domains")
    }

    // MARK: - Storage

    private struct StoredDomainCookie: Codable {
        let domain: String
        let cookieHeader: String
        let updatedAt: Date
    }

    private func ensureLoadedFromKeychain() {
        guard !hasLoadedFromKeychain else { return }

        cached = loadFromKeychain() ?? []
        migrateLegacyIfNeeded()
        hasLoadedFromKeychain = true
    }

    private func saveToKeychain() {
        guard let data = try? JSONEncoder().encode(cached) else { return }
        let ok = KeychainHelper.shared.save(service: keychainService, account: keychainAccountV1, data: data)
        if !ok {
            logger.warning("[SiteLoginsStore] Failed to store cookieHeader in Keychain.")
        }
    }

    private func loadFromKeychain() -> [StoredDomainCookie]? {
        guard let data = KeychainHelper.shared.read(service: keychainService, account: keychainAccountV1) else { return nil }
        return try? JSONDecoder().decode([StoredDomainCookie].self, from: data)
    }

    private func removeFromKeychain() {
        _ = KeychainHelper.shared.delete(service: keychainService, account: keychainAccountV1)
    }

    // MARK: - Migration (best-effort)

    private func migrateLegacyIfNeeded() {
        var didChange = false
        var dict = Dictionary(uniqueKeysWithValues: cached.map { ($0.domain, $0) })

        // WeRead legacy
        if let data = KeychainHelper.shared.read(service: legacyWeReadService, account: legacyWeReadAccount),
           let header = String(data: data, encoding: .utf8) {
            let trimmed = header.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                let now = Date()
                for d in ["weread.qq.com", "i.weread.qq.com"].map(Self.normalizeDomain) {
                    dict[d] = StoredDomainCookie(domain: d, cookieHeader: trimmed, updatedAt: now)
                }
                didChange = true
            }
            _ = KeychainHelper.shared.delete(service: legacyWeReadService, account: legacyWeReadAccount)
        }

        // Dedao legacy
        if let data = KeychainHelper.shared.read(service: legacyDedaoService, account: legacyDedaoAccount),
           let header = String(data: data, encoding: .utf8) {
            let trimmed = header.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                let now = Date()
                for d in ["dedao.cn", "igetget.com"].map(Self.normalizeDomain) {
                    dict[d] = StoredDomainCookie(domain: d, cookieHeader: trimmed, updatedAt: now)
                }
                didChange = true
            }
            _ = KeychainHelper.shared.delete(service: legacyDedaoService, account: legacyDedaoAccount)
        }

        // GoodLinks legacy v2 (domain -> cookieHeader)
        if let data = KeychainHelper.shared.read(service: legacyGoodLinksService, account: legacyGoodLinksAccountV2) {
            struct LegacyGoodLinksV2: Codable {
                let domain: String
                let cookieHeader: String
                let updatedAt: Date
            }
            if let decoded = try? JSONDecoder().decode([LegacyGoodLinksV2].self, from: data) {
                for item in decoded {
                    let d = Self.normalizeDomain(item.domain)
                    let header = item.cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !d.isEmpty, !header.isEmpty else { continue }
                    let existing = dict[d]
                    if existing == nil || item.updatedAt > (existing?.updatedAt ?? .distantPast) {
                        dict[d] = StoredDomainCookie(domain: d, cookieHeader: header, updatedAt: item.updatedAt)
                        didChange = true
                    }
                }
            }
            _ = KeychainHelper.shared.delete(service: legacyGoodLinksService, account: legacyGoodLinksAccountV2)
        }

        // GoodLinks legacy v1 (old per-cookie structure) — just delete
        if KeychainHelper.shared.read(service: legacyGoodLinksService, account: legacyGoodLinksAccountV1) != nil {
            _ = KeychainHelper.shared.delete(service: legacyGoodLinksService, account: legacyGoodLinksAccountV1)
        }

        if didChange {
            cached = dict.values.sorted { $0.domain < $1.domain }
            saveToKeychain()
            logger.info("[SiteLoginsStore] Migrated legacy cookie headers into unified store.")
        }
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
                    continuation.resume()
                }
            }
        }
    }
}
