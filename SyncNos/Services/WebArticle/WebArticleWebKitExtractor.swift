import Foundation
import WebKit

// MARK: - Web Article WebKit Extractor Protocol

protocol WebArticleWebKitExtractorProtocol: AnyObject, Sendable {
    func extractArticle(
        url: URL,
        cookieHeader: String?
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String)
}

// MARK: - Web Article WebKit Extractor

/// 使用离屏 WKWebView 加载并从渲染后的 DOM 抽取正文（支持 SPA / 动态注入内容）。
final class WebArticleWebKitExtractor: NSObject, WebArticleWebKitExtractorProtocol, @unchecked Sendable {
    private let logger: LoggerServiceProtocol
    private let limiter: ConcurrencyLimiter
    
    private struct Sample: Equatable {
        let readyState: String
        let textLen: Int
        let nodeCount: Int
    }

    /// 成功率优先：允许更长的等待时间；并发控制在 2 个。
    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        maxConcurrentLoads: Int = 2
    ) {
        self.logger = logger
        self.limiter = ConcurrencyLimiter(limit: maxConcurrentLoads)
    }

    func extractArticle(
        url: URL,
        cookieHeader: String?
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        try await limiter.withPermit {
            try Task.checkCancellation()
            let startedAt = Date()
            let extracted = try await extractOnMainActor(url: url, cookieHeader: cookieHeader)
            let duration = Date().timeIntervalSince(startedAt)
            logger.info("[WebArticleWebKit] Extracted in \(String(format: "%.2f", duration))s url=\(url.absoluteString)")
            return extracted
        }
    }

    // MARK: - WebView

    @MainActor
    private func extractOnMainActor(
        url: URL,
        cookieHeader: String?
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        let webView = makeWebView()
        defer { webView.navigationDelegate = nil }

        try await loadURL(in: webView, url: url, cookieHeader: cookieHeader)
        try await waitForDOMStabilized(in: webView, timeoutSeconds: 18.0)
        return try await extractFromDOM(in: webView)
    }

    @MainActor
    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isHidden = true
        webView.allowsBackForwardNavigationGestures = false
        return webView
    }

    @MainActor
    private func loadURL(in webView: WKWebView, url: URL, cookieHeader: String?) async throws {
        final class NavigationWaiter: NSObject, WKNavigationDelegate {
            private var didFinish: CheckedContinuation<Void, Error>?

            func wait() async throws {
                try await withCheckedThrowingContinuation { continuation in
                    didFinish = continuation
                }
            }

            func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
                didFinish?.resume()
                didFinish = nil
            }

            func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
                didFinish?.resume(throwing: error)
                didFinish = nil
            }

            func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
                didFinish?.resume(throwing: error)
                didFinish = nil
            }
        }

        let waiter = NavigationWaiter()
        webView.navigationDelegate = waiter

        var request = URLRequest(url: url)
        request.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if let cookieHeader, !cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }

        _ = webView.load(request)
        try await waiter.wait()
    }

    // MARK: - DOM Stabilization

    @MainActor
    private func waitForDOMStabilized(in webView: WKWebView, timeoutSeconds: Double) async throws {
        let deadline = Date().addingTimeInterval(timeoutSeconds)

        var last: Sample?
        var stableTicks = 0

        while Date() < deadline {
            try Task.checkCancellation()

            if let sample = try? await evaluateSample(in: webView) {
                if sample == last {
                    stableTicks += 1
                } else {
                    stableTicks = 0
                    last = sample
                }

                if stableTicks >= 3, sample.textLen > 200 {
                    return
                }
            }

            try? await Task.sleep(nanoseconds: 350_000_000)
        }
    }

    @MainActor
    private func evaluateSample(in webView: WKWebView) async throws -> Sample {
        let script = #"""
        (() => {
          const root =
            document.querySelector('#js_content') ||
            document.querySelector('article') ||
            document.querySelector('main') ||
            document.body;
          const text = root ? (root.innerText || '') : '';
          const nodeCount = root ? root.querySelectorAll('*').length : 0;
          return {
            readyState: document.readyState || '',
            textLen: String(text).trim().length,
            nodeCount: nodeCount
          };
        })();
        """#
        let any = try await evaluateJavaScript(in: webView, script: script)
        guard let dict = any as? [String: Any],
              let readyState = dict["readyState"] as? String,
              let textLen = dict["textLen"] as? Int,
              let nodeCount = dict["nodeCount"] as? Int else {
            throw URLFetchError.parsingFailed
        }
        return Sample(readyState: readyState, textLen: textLen, nodeCount: nodeCount)
    }

    // MARK: - Extract

    @MainActor
    private func extractFromDOM(in webView: WKWebView) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        let script = #"""
        (() => {
          function firstMeta(name, attr = 'name') {
            const el = document.querySelector(`meta[${attr}="${name}"]`);
            return el ? (el.getAttribute('content') || '') : '';
          }

          const title = (firstMeta('og:title', 'property') || firstMeta('twitter:title', 'name') || document.title || '').trim();
          const author = (firstMeta('author', 'name') || firstMeta('article:author', 'property') || '').trim();

          let root =
            document.querySelector('#js_content') ||
            document.querySelector('article') ||
            document.querySelector('main') ||
            document.body;

          if (!root) {
            return JSON.stringify({ title, author, html: '', text: '' });
          }

          // WeChat: js_content 默认隐藏，正文已在 HTML 中，直接解除隐藏。
          if (root.id === 'js_content') {
            root.style.visibility = 'visible';
            root.style.opacity = '1';
          }

          // 移除明显无关/误导的 a11y 提示节点（避免“只剩一行字”的假象）
          const a11y = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
          a11y.forEach(n => n && n.remove());

          const clone = root.cloneNode(true);
          clone.querySelectorAll('script,style,noscript').forEach(n => n.remove());

          const html = '<html><body>' + (clone.outerHTML || '') + '</body></html>';
          const text = (clone.innerText || '').trim();
          return JSON.stringify({ title, author, html, text });
        })();
        """#

        let any = try await evaluateJavaScript(in: webView, script: script)
        guard let json = any as? String else {
            throw URLFetchError.parsingFailed
        }

        struct Payload: Decodable {
            let title: String
            let author: String
            let html: String
            let text: String
        }

        guard let data = json.data(using: .utf8),
              let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
            throw URLFetchError.parsingFailed
        }

        let html = payload.html.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = payload.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !html.isEmpty || !text.isEmpty else {
            throw URLFetchError.contentNotFound
        }

        return (
            title: payload.title.isEmpty ? nil : payload.title,
            author: payload.author.isEmpty ? nil : payload.author,
            contentHTML: html.isEmpty ? "<html><body></body></html>" : html,
            textContent: text
        )
    }

    @MainActor
    private func evaluateJavaScript(in webView: WKWebView, script: String) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { result, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: result as Any)
            }
        }
    }

    private static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
}
