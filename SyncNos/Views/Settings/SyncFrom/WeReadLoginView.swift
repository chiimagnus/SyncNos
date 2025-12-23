import SwiftUI
import WebKit

private struct WeReadWebView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // 无需更新，所有逻辑由外部控制
    }
}

struct WeReadLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = WeReadLoginViewModel()
    @State private var webView = WKWebView()

    let onLoginChanged: () -> Void

    init(onLoginChanged: @escaping () -> Void) {
        self.onLoginChanged = onLoginChanged
    }

    var body: some View {
        WeReadWebView(webView: webView)
            .onAppear {
                if webView.url == nil {
                    if let url = URL(string: "https://weread.qq.com/") {
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
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
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
                onLoginChanged()
            }
        }
    }
}

struct WeReadLoginView_Previews: PreviewProvider {
    static var previews: some View {
        WeReadLoginView(onLoginChanged: {})
    }
}
