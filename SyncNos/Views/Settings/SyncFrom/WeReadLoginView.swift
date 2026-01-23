import SwiftUI

struct WeReadLoginView: View {
    private let authService: WeReadAuthServiceProtocol

    let onLoginChanged: () -> Void

    init(
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        onLoginChanged: @escaping () -> Void
    ) {
        self.authService = authService
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://weread.qq.com/",
            cookieFilter: { _, cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            },
            onSave: { _, _, cookieHeader in
                authService.updateCookieHeader(cookieHeader)
                onLoginChanged()
            }
        )
    }
}

struct WeReadLoginView_Previews: PreviewProvider {
    static var previews: some View {
        WeReadLoginView(onLoginChanged: {})
    }
}
