import SwiftUI

/// GoodLinks 登录视图（WebView 方式）
///
/// 说明：
/// - GoodLinks 可能用于“任意网站”的登录，因此提供 URL 输入框，用户可自行输入需要登录的网站地址。
/// - 保存时仅提取当前页面 Host 及其父域的 cookies，避免误存无关 cookies。
struct GoodLinksLoginView: View {
    @StateObject private var viewModel: GoodLinksLoginViewModel
    
    let onLoginChanged: (() -> Void)?
    
    @MainActor
    init(viewModel: GoodLinksLoginViewModel, onLoginChanged: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onLoginChanged = onLoginChanged
    }
    
    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://",
            cookieFilter: { host, cookie in
                domainMatches(host: host, cookieDomain: cookie.domain)
            },
            onSave: { cookies, host, _ in
                viewModel.saveCookies(cookies, host: host)
                onLoginChanged?()
            }
        )
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
}

struct GoodLinksLoginView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksLoginView(viewModel: GoodLinksLoginViewModel())
    }
}
