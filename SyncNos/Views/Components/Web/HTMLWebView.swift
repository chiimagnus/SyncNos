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
        let userContentController = WKUserContentController()
        configuration.userContentController = userContentController

        // 修复常见懒加载图片（data-src/srcset），以及部分站点设置的 referrerpolicy 导致图片加载失败
        userContentController.addUserScript(
            WKUserScript(
                source: Coordinator.imageNormalizationScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        // 通过 JS ResizeObserver 持续上报内容高度，避免图片/字体加载后高度变化导致内容被截断
        userContentController.add(context.coordinator, name: Coordinator.heightMessageHandlerName)
        userContentController.addUserScript(
            WKUserScript(
                source: Coordinator.heightObserverScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        let webView = PassthroughScrollWKWebView(frame: .zero, configuration: configuration)
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let heightMessageHandlerName = "syncnosHeight"
        static let imageNormalizationScript = #"""
        (() => {
          function isPlaceholder(src) {
            if (!src) return true;
            const s = String(src).trim();
            if (!s) return true;
            if (s.startsWith('data:image/')) return true;
            return false;
          }

          function pickBestFromSrcset(srcset) {
            if (!srcset) return null;
            const parts = String(srcset).split(',').map(p => p.trim()).filter(Boolean);
            if (!parts.length) return null;
            // 取第一个候选即可（浏览器会自行选择合适资源），这里主要保证 src 不为空
            const first = parts[0];
            const segs = first.split(/\s+/).filter(Boolean);
            return segs.length ? segs[0] : null;
          }

          function normalizeOne(img) {
            if (!img) return;
            const src = img.getAttribute('src');
            const dataSrc =
              img.getAttribute('data-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-url');
            const srcset = img.getAttribute('srcset');
            const srcsetCandidate = pickBestFromSrcset(srcset);

            const replacement = dataSrc || srcsetCandidate;
            if (isPlaceholder(src) && replacement) {
              img.setAttribute('src', replacement);
            }

            // 部分站点使用 referrerpolicy=no-referrer，会导致 CDN 按防盗链策略拒绝图片
            img.removeAttribute('referrerpolicy');
          }

          const imgs = Array.from(document.images || []);
          imgs.forEach(normalizeOne);

          // MutationObserver：处理后续动态插入的图片节点
          const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const node of m.addedNodes || []) {
                if (!node) continue;
                if (node.tagName && node.tagName.toLowerCase() === 'img') {
                  normalizeOne(node);
                } else if (node.querySelectorAll) {
                  node.querySelectorAll('img').forEach(normalizeOne);
                }
              }
            }
          });
          mo.observe(document.documentElement, { childList: true, subtree: true });
        })();
        """#

        static let heightObserverScript = #"""
        (() => {
          function reportHeight() {
            const h = Math.max(
              document.body ? document.body.scrollHeight : 0,
              document.documentElement ? document.documentElement.scrollHeight : 0
            );
            try {
              window.webkit.messageHandlers.syncnosHeight.postMessage(h);
            } catch (e) {}
          }

          // 初次上报 + 兜底轮询（图片异步加载、字体加载）
          reportHeight();
          let ticks = 0;
          const timer = setInterval(() => {
            ticks += 1;
            reportHeight();
            if (ticks >= 15) clearInterval(timer);
          }, 250);

          // 观察布局变化（比 didFinish + 1s 更稳）
          if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => reportHeight());
            if (document.body) ro.observe(document.body);
          }

          // 图片加载后高度可能变化
          window.addEventListener('load', () => reportHeight(), { once: true });
        })();
        """#

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

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.heightMessageHandlerName else { return }
            if let value = message.body as? Double, value > 0 {
                onContentHeightChange?(CGFloat(value))
            } else if let value = message.body as? Int, value > 0 {
                onContentHeightChange?(CGFloat(value))
            }
        }
    }

    // MARK: - Styling

    private static func wrapWithStyle(html: String) -> String {
        let normalizedBodyHTML = extractBodyInnerHTML(from: html)
            .map(stripNoscriptWrappersPreservingContent)
            ?? stripNoscriptWrappersPreservingContent(html)
        var displayReadyHTML = sanitizeHiddenInlineStyles(normalizedBodyHTML)
        displayReadyHTML = normalizeImages(displayReadyHTML)

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

    /// 将常见懒加载图片属性提升为 `src`，避免正文图片不显示。
    private static func normalizeImages(_ html: String) -> String {
        guard let imgRegex = try? NSRegularExpression(pattern: "<img\\b[^>]*>", options: [.caseInsensitive]) else {
            return html
        }

        let ns = html as NSString
        let matches = imgRegex.matches(in: html, options: [], range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return html }

        var result = html
        // 从后往前替换，避免 range 位移
        for match in matches.reversed() {
            let tag = (result as NSString).substring(with: match.range)
            let normalizedTag = normalizeImgTag(tag)
            result = (result as NSString).replacingCharacters(in: match.range, with: normalizedTag)
        }
        return result
    }

    private static func normalizeImgTag(_ tag: String) -> String {
        let src = firstAttributeValue(in: tag, name: "src")
        let dataSrc = firstAttributeValue(in: tag, name: "data-src")
            ?? firstAttributeValue(in: tag, name: "data-original")
            ?? firstAttributeValue(in: tag, name: "data-lazy-src")
            ?? firstAttributeValue(in: tag, name: "data-url")
        let srcset = firstAttributeValue(in: tag, name: "srcset")

        let normalizedSrc: String? = {
            if let src, isLikelyValidImageSrc(src) {
                return src
            }
            if let dataSrc, isLikelyValidImageSrc(dataSrc) {
                return dataSrc
            }
            if let srcset, let candidate = firstSrcsetCandidate(srcset), isLikelyValidImageSrc(candidate) {
                return candidate
            }
            return nil
        }()

        guard let normalizedSrc else { return tag }

        if src != nil {
            return replaceAttributeValue(in: tag, name: "src", newValue: normalizedSrc)
        }

        // 没有 src：在 <img 后插入
        if let insertRange = tag.range(of: "<img", options: [.caseInsensitive]) {
            let end = tag.index(insertRange.lowerBound, offsetBy: 3)
            return tag[..<end] + " src=\"\(escapeHTMLAttribute(normalizedSrc))\"" + tag[end...]
        }
        return tag
    }

    private static func firstAttributeValue(in tag: String, name: String) -> String? {
        guard let regex = try? NSRegularExpression(
            pattern: "(?i)\\b\(NSRegularExpression.escapedPattern(for: name))\\s*=\\s*([\"'])(.*?)\\1",
            options: []
        ) else {
            return nil
        }
        let range = NSRange(tag.startIndex..<tag.endIndex, in: tag)
        guard let match = regex.firstMatch(in: tag, options: [], range: range),
              match.numberOfRanges >= 3,
              let valueRange = Range(match.range(at: 2), in: tag) else {
            return nil
        }
        let value = String(tag[valueRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private static func replaceAttributeValue(in tag: String, name: String, newValue: String) -> String {
        guard let regex = try? NSRegularExpression(
            pattern: "(?i)(\\b\(NSRegularExpression.escapedPattern(for: name))\\s*=\\s*)([\"'])(.*?)(\\2)",
            options: []
        ) else {
            return tag
        }
        let range = NSRange(tag.startIndex..<tag.endIndex, in: tag)
        let escaped = escapeHTMLAttribute(newValue)
        return regex.stringByReplacingMatches(
            in: tag,
            options: [],
            range: range,
            withTemplate: "$1$2\(escaped)$4"
        )
    }

    private static func firstSrcsetCandidate(_ srcset: String) -> String? {
        // 取第一个候选（浏览器仍会基于 DPR/宽度做选择，这里只是保证 src 不为空）
        let parts = srcset.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard let first = parts.first, !first.isEmpty else { return nil }
        let segs = first.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        return segs.first?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isLikelyValidImageSrc(_ src: String) -> Bool {
        let trimmed = src.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        // 常见 1x1 占位图
        if trimmed.hasPrefix("data:image/gif") || trimmed.hasPrefix("data:image/png") {
            return false
        }
        return true
    }

    private static func escapeHTMLAttribute(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

// MARK: - Passthrough Scroll

/// 让滚轮事件向上传递，避免鼠标悬停在 WebView 上时父级 ScrollView 无法滚动。
private final class PassthroughScrollWKWebView: WKWebView {
    override func scrollWheel(with event: NSEvent) {
        // 由于我们把 WebView 高度撑到内容高度，内部滚动应尽量禁用，让外层统一滚动。
        nextResponder?.scrollWheel(with: event)
    }
}
