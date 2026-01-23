import SwiftUI

/// 得到登录视图（WebView 方式）
struct DedaoLoginView: View {
    private let siteLoginsStore: SiteLoginsStoreProtocol

    let onLoginChanged: (() -> Void)?

    init(
        siteLoginsStore: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore,
        onLoginChanged: (() -> Void)? = nil
    ) {
        self.siteLoginsStore = siteLoginsStore
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://www.dedao.cn/",
            cookieFilter: { _, cookie in
                cookie.domain.contains("dedao.cn") || cookie.domain.contains("igetget.com")
            },
            onSave: { _, _, cookieHeader in
                Task {
                    await siteLoginsStore.upsertCookieHeader(cookieHeader, forDomains: [
                        "dedao.cn",
                        "igetget.com"
                    ])
                    await MainActor.run {
                        onLoginChanged?()
                    }
                }
            }
        )
    }
}

struct DedaoLoginView_Previews: PreviewProvider {
    static var previews: some View {
        DedaoLoginView(siteLoginsStore: DIContainer.shared.siteLoginsStore)
    }
}
