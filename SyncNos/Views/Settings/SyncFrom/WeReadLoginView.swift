import SwiftUI

struct WeReadLoginView: View {
    @StateObject private var viewModel = WeReadLoginViewModel()

    let onLoginChanged: () -> Void

    init(onLoginChanged: @escaping () -> Void) {
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            defaultURLString: "https://weread.qq.com/",
            cookieFilter: { _, cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            },
            onSave: { _, _, cookieHeader in
                viewModel.saveCookieHeader(cookieHeader)
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
