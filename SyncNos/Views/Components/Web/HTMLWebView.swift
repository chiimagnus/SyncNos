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
        let normalizedBodyHTML = extractBodyInnerHTML(from: html)
            .map(stripNoscriptWrappersPreservingContent)
            ?? stripNoscriptWrappersPreservingContent(html)
        let displayReadyHTML = sanitizeHiddenInlineStyles(normalizedBodyHTML)

        let css = """
        :root {
          color-scheme: light dark;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, system-ui, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 15px;
          line-height: 1.65;
          -webkit-text-size-adjust: 100%;
          word-break: break-word;
          overflow-wrap: anywhere;
          color: rgba(0, 0, 0, 0.88);
          background: transparent;
        }

        @media (prefers-color-scheme: dark) {
          body {
            color: rgba(255, 255, 255, 0.88);
          }
        }

        h1, h2, h3 {
          margin: 0 0 0.6em 0;
          line-height: 1.25;
        }

        p {
          margin: 0 0 0.9em 0;
        }

        ul, ol {
          margin: 0 0 0.9em 1.2em;
          padding: 0;
        }

        li {
          margin: 0.25em 0;
        }

        blockquote {
          margin: 0 0 0.9em 0;
          padding: 0.6em 0.9em;
          border-left: 3px solid rgba(0, 0, 0, 0.18);
          background: rgba(0, 0, 0, 0.04);
        }

        @media (prefers-color-scheme: dark) {
          blockquote {
            border-left-color: rgba(255, 255, 255, 0.22);
            background: rgba(255, 255, 255, 0.06);
          }
        }

        a {
          color: #0A84FF;
          text-decoration: none;
        }

        a:hover {
          text-decoration: underline;
        }

        hr {
          border: none;
          height: 1px;
          background: rgba(0, 0, 0, 0.12);
          margin: 1.0em 0;
        }

        @media (prefers-color-scheme: dark) {
          hr {
            background: rgba(255, 255, 255, 0.18);
          }
        }

        img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 0.6em 0;
        }

        figure {
          margin: 0 0 0.9em 0;
        }

        figcaption {
          margin-top: 0.4em;
          font-size: 12px;
          opacity: 0.72;
        }

        pre {
          margin: 0 0 0.9em 0;
          padding: 0.75em 0.9em;
          overflow-x: auto;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.06);
        }

        @media (prefers-color-scheme: dark) {
          pre {
            background: rgba(255, 255, 255, 0.08);
          }
        }

        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.92em;
        }

        pre code {
          font-size: 0.9em;
        }
        """

        return """
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>\(css)</style>
          </head>
          <body>\(displayReadyHTML)</body>
        </html>
        """
    }

    private static func extractBodyInnerHTML(from html: String) -> String? {
        guard let regex = try? NSRegularExpression(
            pattern: "<body\\b[^>]*>([\\s\\S]*?)<\\/body>",
            options: [.caseInsensitive]
        ) else {
            return nil
        }

        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        guard let match = regex.firstMatch(in: html, options: [], range: range),
              match.numberOfRanges >= 2,
              let bodyRange = Range(match.range(at: 1), in: html) else {
            return nil
        }

        let inner = String(html[bodyRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        return inner.isEmpty ? nil : inner
    }

    private static func stripNoscriptWrappersPreservingContent(_ html: String) -> String {
        html
            .replacingOccurrences(
                of: "<noscript\\b[^>]*>",
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: "<\\/noscript>",
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
    }

    /// 一些站点会把正文节点默认隐藏（依赖外部 CSS/JS 再显示），导致 WebView 渲染“几乎没文字”。
    /// 这里仅移除会导致不可见的内联样式片段，保留其他 style。
    private static func sanitizeHiddenInlineStyles(_ html: String) -> String {
        var result = html
        // display: none
        result = result.replacingOccurrences(
            of: "(?i)display\\s*:\\s*none\\s*;?",
            with: "",
            options: [.regularExpression]
        )
        // visibility: hidden
        result = result.replacingOccurrences(
            of: "(?i)visibility\\s*:\\s*hidden\\s*;?",
            with: "",
            options: [.regularExpression]
        )
        // opacity: 0
        result = result.replacingOccurrences(
            of: "(?i)opacity\\s*:\\s*0(\\.0+)?\\s*;?",
            with: "",
            options: [.regularExpression]
        )
        // -webkit-text-fill-color: transparent / color: transparent
        result = result.replacingOccurrences(
            of: "(?i)-webkit-text-fill-color\\s*:\\s*transparent\\s*;?",
            with: "",
            options: [.regularExpression]
        )
        result = result.replacingOccurrences(
            of: "(?i)color\\s*:\\s*transparent\\s*;?",
            with: "",
            options: [.regularExpression]
        )
        return result
    }
}
