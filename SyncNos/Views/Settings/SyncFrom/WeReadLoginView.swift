import SwiftUI

struct WeReadLoginView: View {
    private let siteLoginsStore: SiteLoginsStoreProtocol

    let onLoginChanged: () -> Void

    init(
        siteLoginsStore: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore,
        onLoginChanged: @escaping () -> Void
    ) {
        self.siteLoginsStore = siteLoginsStore
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://weread.qq.com/",
            cookieFilter: { _, cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            },
            onSave: { _, _, cookieHeader in
                Task {
                    await siteLoginsStore.upsertCookieHeader(cookieHeader, forDomains: [
                        "weread.qq.com",
                        "i.weread.qq.com"
                    ])
                    await MainActor.run {
                        onLoginChanged()
                    }
                }
            }
        )
    }
}

struct WeReadLoginView_Previews: PreviewProvider {
    static var previews: some View {
        WeReadLoginView(onLoginChanged: {})
    }
}
