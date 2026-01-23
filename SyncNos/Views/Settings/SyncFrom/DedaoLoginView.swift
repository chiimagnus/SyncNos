import SwiftUI

/// 得到登录视图（WebView 方式）
struct DedaoLoginView: View {
    @StateObject private var viewModel: DedaoLoginViewModel

    let onLoginChanged: (() -> Void)?

    init(viewModel: DedaoLoginViewModel, onLoginChanged: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        CookieWebLoginSheet(
            initialURL: URL(string: "https://www.dedao.cn/")!,
            cookieFilter: { cookie in
                cookie.domain.contains("dedao.cn") || cookie.domain.contains("igetget.com")
            },
            onSaveCookieHeader: { header in
                viewModel.saveCookieHeader(header)
                onLoginChanged?()
            }
        )
    }
}

struct DedaoLoginView_Previews: PreviewProvider {
    static var previews: some View {
        DedaoLoginView(
            viewModel: DedaoLoginViewModel(
                authService: DIContainer.shared.dedaoAuthService,
                apiService: DIContainer.shared.dedaoAPIService
            )
        )
    }
}
