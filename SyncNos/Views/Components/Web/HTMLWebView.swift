import SwiftUI
import AppKit
import WebKit

// MARK: - HTML WebView

/// 用 WKWebView 渲染 HTML（用于文章富内容展示）
struct HTMLWebView: NSViewRepresentable {
    // MARK: - Properties

    let html: String
    let baseURL: URL?
    let originalPageURL: URL?
    let openLinksInExternalBrowser: Bool
    let onRefetchRequested: (() -> Void)?
    let searchQuery: String?
    @Binding var contentHeight: CGFloat

    init(
        html: String,
        baseURL: URL? = nil,
        originalPageURL: URL? = nil,
        openLinksInExternalBrowser: Bool = true,
        onRefetchRequested: (() -> Void)? = nil,
        searchQuery: String? = nil,
        contentHeight: Binding<CGFloat>
    ) {
        self.html = html
        self.baseURL = baseURL
        self.originalPageURL = originalPageURL
        self.openLinksInExternalBrowser = openLinksInExternalBrowser
        self.onRefetchRequested = onRefetchRequested
        self.searchQuery = searchQuery
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

        // 正文搜索（Detail ⌘F）：命中高亮
        userContentController.addUserScript(
            WKUserScript(
                source: Coordinator.searchScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        let webView = PassthroughScrollWKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        if let scrollView = webView.enclosingScrollView {
            scrollView.drawsBackground = false
            scrollView.hasVerticalScroller = false
            scrollView.hasHorizontalScroller = false
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let styledHTML = HTMLWebView.wrapWithStyle(html: html, originalPageURL: originalPageURL)
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
        if let menuWebView = webView as? PassthroughScrollWKWebView {
            menuWebView.onRefetchRequested = onRefetchRequested
            menuWebView.onRefreshRenderRequested = { [weak webView] in
                webView?.reload()
            }
        }

        context.coordinator.updateSearch(webView: webView, query: searchQuery)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(openLinksInExternalBrowser: openLinksInExternalBrowser)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
        static let heightMessageHandlerName = "syncnosHeight"
        static let searchScript = #"""
        (() => {
          if (window.SyncNosSearch) return;

          const HIT_CLASS = 'syncnos-search-hit';

          function tokenize(query) {
            if (!query) return [];
            return String(query).trim().split(/\s+/).map(s => s.trim()).filter(Boolean);
          }

          function clearHighlights() {
            const marks = Array.from(document.querySelectorAll('mark.' + HIT_CLASS));
            for (const mark of marks) {
              const parent = mark.parentNode;
              if (!parent) continue;
              while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
              parent.removeChild(mark);
              parent.normalize();
            }
          }

          function bodyContainsAllTokens(tokens) {
            if (!tokens.length) return true;
            const haystack = (document.body ? document.body.innerText : '').toLowerCase();
            for (const t of tokens) {
              if (haystack.indexOf(String(t).toLowerCase()) < 0) return false;
            }
            return true;
          }

          function collectMatchesInText(text, tokens) {
            const lower = String(text).toLowerCase();
            const matches = [];
            for (const rawToken of tokens) {
              const token = String(rawToken).toLowerCase();
              if (!token) continue;
              let idx = 0;
              while (true) {
                const pos = lower.indexOf(token, idx);
                if (pos < 0) break;
                matches.push([pos, pos + token.length]);
                idx = pos + token.length;
              }
            }
            if (!matches.length) return [];
            matches.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const merged = [];
            let cur = matches[0];
            for (let i = 1; i < matches.length; i++) {
              const m = matches[i];
              if (m[0] <= cur[1]) {
                cur[1] = Math.max(cur[1], m[1]);
              } else {
                merged.push(cur);
                cur = m;
              }
            }
            merged.push(cur);
            return merged;
          }

          function highlight(query) {
            clearHighlights();
            const tokens = tokenize(query);
            if (!tokens.length) return 0;
            if (!bodyContainsAllTokens(tokens)) return 0;

            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(node) {
                  if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
                  const v = String(node.nodeValue);
                  if (!v.trim()) return NodeFilter.FILTER_REJECT;
                  const p = node.parentNode;
                  if (!p) return NodeFilter.FILTER_REJECT;
                  const tag = (p.nodeName || '').toLowerCase();
                  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'textarea' || tag === 'input') {
                    return NodeFilter.FILTER_REJECT;
                  }
                  if (p.closest && p.closest('mark.' + HIT_CLASS)) return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );

            let hitIndex = 0;
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            for (const node of nodes) {
              const text = node.nodeValue;
              const matches = collectMatchesInText(text, tokens);
              if (!matches.length) continue;

              const frag = document.createDocumentFragment();
              let cursor = 0;
              for (const m of matches) {
                const start = m[0];
                const end = m[1];
                if (start > cursor) {
                  frag.appendChild(document.createTextNode(text.slice(cursor, start)));
                }
                const mark = document.createElement('mark');
                mark.className = HIT_CLASS;
                mark.dataset.syncnosHitIndex = String(hitIndex);
                hitIndex += 1;
                mark.appendChild(document.createTextNode(text.slice(start, end)));
                frag.appendChild(mark);
                cursor = end;
              }
              if (cursor < text.length) {
                frag.appendChild(document.createTextNode(text.slice(cursor)));
              }
              node.parentNode.replaceChild(frag, node);
            }

            return hitIndex;
          }

          function setQuery(query) {
            if (!query || !String(query).trim()) {
              clearHighlights();
              return 0;
            }
            const count = highlight(query);
            return count;
          }

          window.SyncNosSearch = {
            setQuery,
            highlight,
            clearHighlights
          };
        })();
        """#
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
        var lastSearchQuery: String?

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

            // 页面刷新后需要重新应用搜索高亮（mark 会丢失）
            updateSearch(webView: webView, query: lastSearchQuery, force: true)
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

        // MARK: - Search Highlight

        func updateSearch(webView: WKWebView, query: String?, force: Bool = false) {
            let normalizedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines)
            let effectiveQuery = (normalizedQuery?.isEmpty == false) ? normalizedQuery : nil

            if force {
                lastSearchQuery = effectiveQuery
                applyQuery(webView: webView, query: effectiveQuery)
                return
            }

            if effectiveQuery != lastSearchQuery {
                lastSearchQuery = effectiveQuery
                applyQuery(webView: webView, query: effectiveQuery)
                return
            }
        }

        private func applyQuery(webView: WKWebView, query: String?) {
            if let query {
                let jsQuery = escapeJSString(query)
                let script = "window.SyncNosSearch && window.SyncNosSearch.setQuery('\(jsQuery)');"
                webView.evaluateJavaScript(script, completionHandler: nil)
            } else {
                let script = "window.SyncNosSearch && window.SyncNosSearch.clearHighlights();"
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func escapeJSString(_ s: String) -> String {
            var result = s
            result = result.replacingOccurrences(of: "\\\\", with: "\\\\\\\\")
            result = result.replacingOccurrences(of: "'", with: "\\\\'")
            result = result.replacingOccurrences(of: "\n", with: "\\\\n")
            result = result.replacingOccurrences(of: "\r", with: "")
            result = result.replacingOccurrences(of: "\u{2028}", with: "\\\\u2028")
            result = result.replacingOccurrences(of: "\u{2029}", with: "\\\\u2029")
            return result
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

    private static func wrapWithStyle(html: String, originalPageURL: URL?) -> String {
        let normalizedBodyHTML = extractBodyInnerHTML(from: html)
            .map(stripNoscriptWrappersPreservingContent)
            ?? stripNoscriptWrappersPreservingContent(html)
        var displayReadyHTML = sanitizeHiddenInlineStyles(normalizedBodyHTML)
        displayReadyHTML = normalizeImages(displayReadyHTML)

        let originalURLAttribute = originalPageURL?.absoluteString ?? ""

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

        mark.syncnos-search-hit {
          background: rgba(255, 230, 0, 0.35);
          padding: 0 0.08em;
          border-radius: 0.18em;
        }

        mark.syncnos-search-hit.syncnos-search-active {
          background: rgba(255, 200, 0, 0.60);
        }

        img {
          max-width: 100%;
          height: auto;
        }

        iframe, video {
          max-width: 100%;
        }

        .sn-media-fallback {
          margin: 0.8em 0;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: rgba(0, 0, 0, 0.03);
        }

        @media (prefers-color-scheme: dark) {
          .sn-media-fallback {
            border-color: rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.06);
          }
        }

        .sn-media-cover {
          width: 100%;
          height: auto;
          display: block;
          margin: 0;
          background: rgba(0, 0, 0, 0.08);
          aspect-ratio: 16 / 9;
          object-fit: cover;
        }

        .sn-media-cover-placeholder {
          width: 100%;
          aspect-ratio: 16 / 9;
          background: rgba(0, 0, 0, 0.10);
        }

        @media (prefers-color-scheme: dark) {
          .sn-media-cover-placeholder {
            background: rgba(255, 255, 255, 0.10);
          }
        }

        .sn-media-actions {
          display: flex;
          justify-content: flex-end;
          padding: 10px 12px;
        }

        .sn-open-original {
          display: inline-block;
          padding: 7px 10px;
          border-radius: 10px;
          border: 1px solid rgba(0, 0, 0, 0.16);
          background: rgba(255, 255, 255, 0.65);
          color: inherit;
          text-decoration: none;
          font-size: 13px;
        }

        @media (prefers-color-scheme: dark) {
          .sn-open-original {
            border-color: rgba(255, 255, 255, 0.18);
            background: rgba(0, 0, 0, 0.24);
          }
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

        let mediaFallbackScript = """
        (() => {
          const originalUrl = document.body ? (document.body.getAttribute('data-syncnos-original-url') || '') : '';
          if (!originalUrl) return;

          function firstNonEmpty(values) {
            for (const v of values) {
              if (v == null) continue;
              const s = String(v).trim();
              if (s) return s;
            }
            return '';
          }

          function coverFor(el) {
            if (!el) return '';

            if (el.tagName && el.tagName.toLowerCase() === 'video') {
              return firstNonEmpty([el.poster, el.getAttribute('poster'), el.getAttribute('data-cover'), el.getAttribute('data-poster')]);
            }

            const own = firstNonEmpty([
              el.getAttribute('data-cover'),
              el.getAttribute('data-cover-url'),
              el.getAttribute('data-poster'),
              el.getAttribute('poster'),
              el.getAttribute('cover')
            ]);
            if (own) return own;

            // 尝试在附近找一张图当封面
            let p = el.parentElement;
            for (let i = 0; i < 3 && p; i += 1) {
              const img = p.querySelector && p.querySelector('img');
              const src = img ? (img.getAttribute('src') || '') : '';
              const trimmed = String(src).trim();
              if (trimmed) return trimmed;
              p = p.parentElement;
            }
            return '';
          }

          function buildFallbackHTML(cover) {
            const safeCover = cover ? String(cover).replace(/\"/g, '&quot;') : '';
            const coverHTML = safeCover
              ? `<img class="sn-media-cover" src="${safeCover}" />`
              : `<div class="sn-media-cover-placeholder"></div>`;
            return `
              <div class="sn-media-fallback">
                ${coverHTML}
                <div class="sn-media-actions">
                  <a class="sn-open-original" href="${originalUrl}">打开原网页观看</a>
                </div>
              </div>
            `;
          }

          function replaceWithFallback(el) {
            if (!el || !el.parentNode) return;
            const cover = coverFor(el);
            const wrapper = document.createElement('div');
            wrapper.innerHTML = buildFallbackHTML(cover);
            const node = wrapper.firstElementChild;
            if (!node) return;
            el.parentNode.replaceChild(node, el);
          }

          function isLikelyVideoIframe(el) {
            if (!el) return false;
            const cls = firstNonEmpty([el.getAttribute('class'), el.getAttribute('data-type')]).toLowerCase();
            if (cls.includes('video')) return true;
            const src = firstNonEmpty([el.getAttribute('src'), el.getAttribute('data-src')]).toLowerCase();
            if (!src) return false;
            if (src.includes('videoplayer')) return true;
            if (src.includes('/video')) return true;
            return false;
          }

          // 1) video：如果加载/解码失败，替换为“封面 + 打开原网页”
          document.querySelectorAll('video').forEach((v) => {
            if (!v) return;
            let replaced = false;
            const fail = () => {
              if (replaced) return;
              replaced = true;
              replaceWithFallback(v);
            };
            v.addEventListener('error', fail, { once: true });
            // 没有任何可用源：直接降级
            const hasSrc = !!(v.getAttribute('src') || (v.querySelector && v.querySelector('source')));
            if (!hasSrc) {
              fail();
            }
          });

          // 2) iframe：视频类 iframe 如果在短时间内未完成加载，替换为“封面 + 打开原网页”
          document.querySelectorAll('iframe').forEach((f) => {
            if (!isLikelyVideoIframe(f)) return;
            let loaded = false;
            f.addEventListener('load', () => { loaded = true; }, { once: true });
            setTimeout(() => {
              if (!loaded) replaceWithFallback(f);
            }, 4000);
          });
        })();
        """

        return """
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>\(css)</style>
          </head>
          <body data-syncnos-original-url="\(escapeHTMLAttribute(originalURLAttribute))">
            \(displayReadyHTML)
            <script>\(mediaFallbackScript)</script>
          </body>
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
    // MARK: - Actions

    /// 触发“重新抓取正文”（走 ViewModel 的完整抓取链路）
    var onRefetchRequested: (() -> Void)?
    /// 仅刷新当前渲染（不触发抓取/缓存写入）
    var onRefreshRenderRequested: (() -> Void)?

    override func scrollWheel(with event: NSEvent) {
        // 由于我们把 WebView 高度撑到内容高度，内部滚动应尽量禁用，让外层统一滚动。
        nextResponder?.scrollWheel(with: event)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()

        // 避免菜单复用时重复插入自定义项
        if menu.items.contains(where: { $0.action == #selector(handleRefetchRequested) }) {
            return menu
        }

        let refreshItem = findReloadMenuItem(in: menu)
        if let refreshItem {
            refreshItem.title = "仅刷新当前渲染"
        }

        let refetchItem = NSMenuItem(
            title: "重新抓取正文",
            action: #selector(handleRefetchRequested),
            keyEquivalent: ""
        )
        refetchItem.target = self
        refetchItem.isEnabled = onRefetchRequested != nil

        if let refreshItem, let idx = menu.items.firstIndex(of: refreshItem) {
            menu.insertItem(refetchItem, at: idx)
            menu.insertItem(.separator(), at: idx + 1)
        } else {
            // 未能识别出“重新载入”项：提供一个明确的“仅刷新当前渲染”
            let refreshOnly = NSMenuItem(
                title: "仅刷新当前渲染",
                action: #selector(handleRefreshRenderRequested),
                keyEquivalent: ""
            )
            refreshOnly.target = self
            refreshOnly.isEnabled = true

            menu.insertItem(refetchItem, at: 0)
            menu.insertItem(refreshOnly, at: 1)
            menu.insertItem(.separator(), at: 2)
        }

        return menu
    }

    // MARK: - Menu Handlers

    @objc private func handleRefetchRequested() {
        onRefetchRequested?()
    }

    @objc private func handleRefreshRenderRequested() {
        if let onRefreshRenderRequested {
            onRefreshRenderRequested()
        } else {
            reload()
        }
    }

    // MARK: - Helpers

    private func findReloadMenuItem(in menu: NSMenu) -> NSMenuItem? {
        for item in menu.items {
            if let submenu = item.submenu,
               let found = findReloadMenuItem(in: submenu) {
                return found
            }

            guard let action = item.action else { continue }
            let name = NSStringFromSelector(action)
            // WebKit 可能使用内部 selector；这里尽量稳妥地匹配 reload 语义
            if name == "reload:" || name == "reload" || name.lowercased().contains("reload") {
                return item
            }
        }
        return nil
    }
}
