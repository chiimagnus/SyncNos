import SwiftUI

/// GoodLinks 登录视图（WebView 方式）
///
/// 说明：
/// - GoodLinks 可能用于“任意网站”的登录，因此提供 URL 输入框，用户可自行输入需要登录的网站地址。
/// - 保存时仅提取当前页面 Host 及其父域的 cookies，避免误存无关 cookies。
struct GoodLinksLoginView: View {
    private let siteLoginsStore: SiteLoginsStoreProtocol
    
    let onLoginChanged: (() -> Void)?
    
    @MainActor
    init(
        siteLoginsStore: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore,
        onLoginChanged: (() -> Void)? = nil
    ) {
        self.siteLoginsStore = siteLoginsStore
        self.onLoginChanged = onLoginChanged
    }
    
    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://",
            cookieFilter: { host, cookie in
                domainMatches(host: host, cookieDomain: cookie.domain)
            },
            onSave: { cookies, host, cookieHeader in
                let storageDomain = computeStorageDomain(host: host, cookies: cookies)
                Task {
                    await siteLoginsStore.upsertCookieHeader(cookieHeader, forDomain: storageDomain)
                    await MainActor.run {
                        onLoginChanged?()
                    }
                }
            }
        )
    }
    
    private func computeStorageDomain(host: String, cookies: [HTTPCookie]) -> String {
        let h = normalizeDomain(host)
        guard !h.isEmpty else { return host }
        
        let candidates = Set(cookies.map { normalizeDomain($0.domain) })
            .filter { !$0.isEmpty && domainMatches(host: h, cookieDomain: $0) }
            .sorted { $0.count < $1.count }
        
        return candidates.first ?? h
    }
    
    private func domainMatches(host: String, cookieDomain: String) -> Bool {
        let h = host.lowercased()
        let d = cookieDomain
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !h.isEmpty, !d.isEmpty else { return false }
        if h == d { return true }
        return h.hasSuffix("." + d)
    }

    private func normalizeDomain(_ domain: String) -> String {
        domain
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
}

struct GoodLinksLoginView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksLoginView()
    }
}
