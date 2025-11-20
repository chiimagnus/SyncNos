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
        VStack(spacing: 12) {
            Text("Login to WeRead")
                .font(.title2)
                .fontWeight(.semibold)

            WeReadWebView(webView: webView)
                .frame(minWidth: 600, minHeight: 400)
                .onAppear {
                    if webView.url == nil {
                        if let url = URL(string: "https://weread.qq.com/") {
                            let request = URLRequest(url: url)
                            webView.load(request)
                        }
                    }
                }

            HStack {
                Button {
                    captureCookiesFromWebView()
                } label: {
                    Label("Save Cookies from WebView", systemImage: "checkmark.circle")
                }

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Text("Done")
                }
            }
            .padding(.horizontal)

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }

                Text("Or paste WeRead Cookie header manually:")
                    .font(.footnote)
                    .foregroundColor(.secondary)

                TextEditor(text: $viewModel.manualCookie)
                    .font(.system(.body, design: .monospaced))
                    .frame(height: 80)
                    .border(Color.secondary.opacity(0.3))

                HStack {
                    Button {
                        viewModel.applyManualCookie()
                        onLoginChanged()
                    } label: {
                        Label("Save Manual Cookie", systemImage: "square.and.arrow.down")
                    }

                    Spacer()

                    if viewModel.isLoggedIn {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(.green)
                            .help("WeRead login detected")
                    } else {
                        Image(systemName: "xmark.seal")
                            .foregroundColor(.secondary)
                            .help("WeRead not logged in")
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .frame(minWidth: 640, minHeight: 600)
    }

    private func captureCookiesFromWebView() {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let relevant = cookies.filter { cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            }
            guard !relevant.isEmpty else {
                Task { @MainActor in
                    viewModel.statusMessage = NSLocalizedString("No WeRead cookies found. Please login in the web view first.", comment: "")
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
