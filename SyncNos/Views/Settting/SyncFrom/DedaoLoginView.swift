import SwiftUI
import WebKit

/// 得到 WebView 封装
private struct DedaoWebView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // 无需更新，所有逻辑由外部控制
    }
}

/// 得到登录视图（WebView 方式）
struct DedaoLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: DedaoLoginViewModel
    @State private var webView = WKWebView()

    let onLoginChanged: (() -> Void)?

    init(viewModel: DedaoLoginViewModel, onLoginChanged: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        DedaoWebView(webView: webView)
            .onAppear {
                if webView.url == nil {
                    if let url = URL(string: "https://www.dedao.cn/") {
                        let request = URLRequest(url: url)
                        webView.load(request)
                    }
                }
            }
            .frame(minWidth: 640, minHeight: 600)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        captureCookiesFromWebView()
                        dismiss()
                    } label: {
                        Label("Save Cookies from WebView", systemImage: "checkmark.circle")
                    }
                }
            }
    }

    private func captureCookiesFromWebView() {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let relevant = cookies.filter { cookie in
                cookie.domain.contains("dedao.cn") || cookie.domain.contains("igetget.com")
            }
            guard !relevant.isEmpty else {
                Task { @MainActor in
                    viewModel.statusMessage = String(localized: "No cookies found. Please log in via the web view first.")
                }
                return
            }
            let header = relevant.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
            Task { @MainActor in
                viewModel.saveCookieHeader(header)
                onLoginChanged?()
            }
        }
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
