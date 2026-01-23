import SwiftUI
import WebKit

private struct CookieWebView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // 无需更新，所有逻辑由外部控制
    }
}

/// 通用 WebView 登录 Sheet：从 WebView 捕获 cookies 并保存为 `cookieHeader`
struct CookieWebLoginSheet: View {
    @Environment(\.dismiss) private var dismiss

    let initialURL: URL
    let cookieFilter: (HTTPCookie) -> Bool
    let onSaveCookieHeader: @MainActor (String) -> Void

    @State private var webView = WKWebView()
    @State private var statusMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            if let statusMessage, !statusMessage.isEmpty {
                HStack {
                    Text(statusMessage)
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 10)
                .padding(.bottom, 8)
            }

            CookieWebView(webView: webView)
        }
        .frame(minWidth: 640, minHeight: 600)
        .onAppear {
            if webView.url == nil {
                webView.load(URLRequest(url: initialURL))
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    captureCookiesFromWebView()
                } label: {
                    Label("Save Cookies from WebView", systemImage: "checkmark.circle")
                }
            }
        }
    }

    private func captureCookiesFromWebView() {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let relevant = cookies.filter(cookieFilter)
            guard !relevant.isEmpty else {
                Task { @MainActor in
                    statusMessage = String(localized: "No cookies found. Please log in via the web view first.")
                }
                return
            }

            let headerFields = HTTPCookie.requestHeaderFields(with: relevant)
            let header = headerFields["Cookie"] ?? relevant.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")

            Task { @MainActor in
                onSaveCookieHeader(header)
                dismiss()
            }
        }
    }
}

