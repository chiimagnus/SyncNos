import SwiftUI
import WebKit

struct WeReadLoginView: NSViewRepresentable {
    let url: URL
    
    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }
    
    func updateNSView(_ nsView: WKWebView, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WeReadLoginView
        
        init(_ parent: WeReadLoginView) {
            self.parent = parent
        }
        
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task {
                await WeReadAuthService.shared.updateCookies(from: webView)
            }
        }
        
        // Capture redirects as well potentially
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            Task {
                await WeReadAuthService.shared.updateCookies(from: webView)
            }
            decisionHandler(.allow)
        }
    }
}

struct WeReadLoginSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var isLoggedIn = WeReadAuthService.shared.isLoggedIn
    
    var body: some View {
        VStack {
            if isLoggedIn {
                Text("Logged in successfully!")
                    .font(.title)
                    .foregroundColor(.green)
                Button("Close") {
                    dismiss()
                }
                .padding()
            } else {
                WeReadLoginView(url: URL(string: "https://weread.qq.com/")!)
                    .frame(width: 800, height: 600)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("WeReadLoginStatusChanged"))) { _ in
            if WeReadAuthService.shared.isLoggedIn {
                isLoggedIn = true
            }
        }
    }
}

