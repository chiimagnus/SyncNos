import SwiftUI

struct WeReadLoginView: View {
    @StateObject private var viewModel = WeReadLoginViewModel()

    let onLoginChanged: () -> Void

    init(onLoginChanged: @escaping () -> Void) {
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            initialURL: URL(string: "https://weread.qq.com/")!,
            cookieFilter: { cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            },
            onSaveCookieHeader: { header in
                viewModel.saveCookieHeader(header)
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
