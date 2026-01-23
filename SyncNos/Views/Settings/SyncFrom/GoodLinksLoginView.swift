import SwiftUI
import WebKit

private struct GoodLinksWebView: NSViewRepresentable {
    let webView: WKWebView
    
    func makeNSView(context: Context) -> WKWebView {
        webView
    }
    
    func updateNSView(_ nsView: WKWebView, context: Context) {
        // 无需更新，所有逻辑由外部控制
    }
}

/// GoodLinks 登录视图（WebView 方式）
///
/// 说明：
/// - GoodLinks 可能用于“任意网站”的登录，因此提供 URL 输入框，用户可自行输入需要登录的网站地址。
/// - 保存时仅提取当前页面 Host 及其父域的 cookies，避免误存无关 cookies。
struct GoodLinksLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: GoodLinksLoginViewModel
    @State private var webView = WKWebView()
    @State private var currentURL: String = ""
    
    let onLoginChanged: (() -> Void)?
    
    @MainActor
    init(viewModel: GoodLinksLoginViewModel, onLoginChanged: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onLoginChanged = onLoginChanged
    }
    
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
            
            if let msg = viewModel.statusMessage, !msg.isEmpty {
                HStack {
                    Text(msg)
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            
            GoodLinksWebView(webView: webView)
        }
        .frame(minWidth: 720, minHeight: 640)
        .onAppear {
            if currentURL.isEmpty {
                currentURL = webView.url?.absoluteString ?? "https://"
            }
        }
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
    
    private func loadCurrentURL() {
        let trimmed = currentURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            viewModel.statusMessage = String(localized: "Invalid URL.")
            return
        }
        webView.load(URLRequest(url: url))
    }
    
    private func captureCookiesFromWebView() {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let host = webView.url?.host ?? URL(string: currentURL)?.host
            let relevant: [HTTPCookie]
            if let host, !host.isEmpty {
                relevant = cookies.filter { domainMatches(host: host, cookieDomain: $0.domain) }
            } else {
                relevant = []
            }
            
            guard !relevant.isEmpty else {
                Task { @MainActor in
                    viewModel.statusMessage = String(localized: "No cookies found. Please log in via the web view first.")
                }
                return
            }
            
            Task { @MainActor in
                viewModel.saveCookies(relevant)
                onLoginChanged?()
            }
        }
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

