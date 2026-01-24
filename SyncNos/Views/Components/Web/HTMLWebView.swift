import SwiftUI
import AppKit
import WebKit

// MARK: - HTML WebView

/// 用 WKWebView 渲染 HTML（用于文章富内容展示）
struct HTMLWebView: NSViewRepresentable {
    // MARK: - Properties

    let html: String
    let baseURL: URL?
    let openLinksInExternalBrowser: Bool
    @Binding var contentHeight: CGFloat

    init(
        html: String,
        baseURL: URL? = nil,
        openLinksInExternalBrowser: Bool = true,
        contentHeight: Binding<CGFloat>
    ) {
        self.html = html
        self.baseURL = baseURL
        self.openLinksInExternalBrowser = openLinksInExternalBrowser
        self._contentHeight = contentHeight
    }

    // MARK: - NSViewRepresentable

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        if let scrollView = webView.enclosingScrollView {
            scrollView.drawsBackground = false
            scrollView.hasVerticalScroller = false
            scrollView.hasHorizontalScroller = false
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let styledHTML = HTMLWebView.wrapWithStyle(html: html)
        if context.coordinator.lastLoadedHTML != styledHTML || context.coordinator.lastLoadedBaseURL != baseURL {
            context.coordinator.lastLoadedHTML = styledHTML
            context.coordinator.lastLoadedBaseURL = baseURL
            webView.loadHTMLString(styledHTML, baseURL: baseURL)
        }
        context.coordinator.onContentHeightChange = { height in
            if abs(contentHeight - height) > 1 {
                contentHeight = height
            }
        }
        context.coordinator.openLinksInExternalBrowser = openLinksInExternalBrowser
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(openLinksInExternalBrowser: openLinksInExternalBrowser)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastLoadedHTML: String?
        var lastLoadedBaseURL: URL?
        var openLinksInExternalBrowser: Bool
        var onContentHeightChange: ((CGFloat) -> Void)?

        init(openLinksInExternalBrowser: Bool) {
            self.openLinksInExternalBrowser = openLinksInExternalBrowser
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard openLinksInExternalBrowser else {
                decisionHandler(.allow)
                return
            }

            // 仅拦截用户点击的链接
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            measureContentHeight(webView: webView)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.measureContentHeight(webView: webView)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.measureContentHeight(webView: webView)
            }
        }

        private func measureContentHeight(webView: WKWebView) {
            let script = """
            Math.max(
              document.body ? document.body.scrollHeight : 0,
              document.documentElement ? document.documentElement.scrollHeight : 0
            )
            """
            webView.evaluateJavaScript(script) { [weak self] result, _ in
                guard let self else { return }
                if let value = result as? Double, value > 0 {
                    self.onContentHeightChange?(CGFloat(value))
                }
            }
        }
    }

    // MARK: - Styling

    private static func wrapWithStyle(html: String) -> String {
        let css = """
        img { max-width: 100%; height: auto; }
        body { margin: 0; padding: 0; }
        """

        return """
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>\(css)</style>
          </head>
          <body>\(html)</body>
        </html>
        """
    }
}
