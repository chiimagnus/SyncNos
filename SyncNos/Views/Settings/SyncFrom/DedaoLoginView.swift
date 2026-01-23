import SwiftUI

/// 得到登录视图（WebView 方式）
struct DedaoLoginView: View {
    private let authService: DedaoAuthServiceProtocol

    let onLoginChanged: (() -> Void)?

    init(
        authService: DedaoAuthServiceProtocol = DIContainer.shared.dedaoAuthService,
        onLoginChanged: (() -> Void)? = nil
    ) {
        self.authService = authService
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://www.dedao.cn/",
            cookieFilter: { _, cookie in
                cookie.domain.contains("dedao.cn") || cookie.domain.contains("igetget.com")
            },
            onSave: { _, _, cookieHeader in
                authService.updateCookieHeader(cookieHeader)
                onLoginChanged?()
            }
        )
    }
}

struct DedaoLoginView_Previews: PreviewProvider {
    static var previews: some View {
        DedaoLoginView(authService: DIContainer.shared.dedaoAuthService)
    }
}
