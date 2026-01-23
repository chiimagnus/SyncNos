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

    let defaultURLString: String
    let cookieFilter: (_ currentHost: String, _ cookie: HTTPCookie) -> Bool
    let onSave: @MainActor (_ cookies: [HTTPCookie], _ host: String, _ cookieHeader: String) -> Void

    @State private var webView = WKWebView()
    @State private var statusMessage: String?
    @State private var currentURL: String = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("Enter URL", text: $currentURL)
                    .textFieldStyle(.roundedBorder)

                Button("Go") {
                    loadCurrentURL()
                }
                .buttonStyle(.bordered)
            }
            .padding()

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
        .frame(minWidth: 720, minHeight: 640)
        .onAppear {
            if currentURL.isEmpty {
                currentURL = webView.url?.absoluteString ?? defaultURLString
            }
            if webView.url == nil {
                loadCurrentURL()
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

    private func loadCurrentURL() {
        let trimmed = currentURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            statusMessage = String(localized: "Invalid URL.")
            return
        }
        webView.load(URLRequest(url: url))
    }

    private func captureCookiesFromWebView() {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let host = webView.url?.host ?? URL(string: currentURL)?.host
            guard let host, !host.isEmpty else {
                Task { @MainActor in
                    statusMessage = String(localized: "Invalid URL.")
                }
                return
            }

            let relevant = cookies.filter { cookieFilter(host, $0) }
            guard !relevant.isEmpty else {
                Task { @MainActor in
                    statusMessage = String(localized: "No cookies found. Please log in via the web view first.")
                }
                return
            }

            let headerFields = HTTPCookie.requestHeaderFields(with: relevant)
            let header = headerFields["Cookie"] ?? relevant.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")

            Task { @MainActor in
                onSave(relevant, host, header)
                dismiss()
            }
        }
    }
}
