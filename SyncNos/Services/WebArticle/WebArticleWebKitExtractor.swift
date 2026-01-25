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
    
    @MainActor
    private var webViewPool: [WKWebView] = []
    
    private let stabilizationTimeoutSeconds: Double
    private let stabilizationMinTextLength: Int

    /// 成功率优先：允许更长的等待时间；并发控制在 2 个。
    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        maxConcurrentLoads: Int = 2,
        stabilizationTimeoutSeconds: Double = 10.0,
        stabilizationMinTextLength: Int = 240
    ) {
        self.logger = logger
        self.limiter = ConcurrencyLimiter(limit: maxConcurrentLoads)
        self.stabilizationTimeoutSeconds = stabilizationTimeoutSeconds
        self.stabilizationMinTextLength = stabilizationMinTextLength
    }

    func extractArticle(
        url: URL,
        cookieHeader: String?
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        try await limiter.withPermit {
            try Task.checkCancellation()
            let startedAt = Date()
            let readabilityScript: String
            do {
                readabilityScript = try ReadabilityScriptProvider.loadScript()
            } catch {
                logger.error("[WebArticleWebKit] Failed to load Readability.js: \(error.localizedDescription)")
                throw URLFetchError.parsingFailed
            }
            let extracted = try await extractOnMainActor(url: url, cookieHeader: cookieHeader, readabilityScript: readabilityScript)
            let duration = Date().timeIntervalSince(startedAt)
            logger.info("[WebArticleWebKit] Extracted in \(String(format: "%.2f", duration))s url=\(url.absoluteString)")
            return extracted
        }
    }

    // MARK: - WebView

    @MainActor
    private func extractOnMainActor(
        url: URL,
        cookieHeader: String?,
        readabilityScript: String
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        let webView = acquireWebView(readabilityScript: readabilityScript)
        defer { releaseWebView(webView) }

        try await loadURL(in: webView, url: url, cookieHeader: cookieHeader)
        try await waitForDOMStabilized(in: webView, timeoutSeconds: stabilizationTimeoutSeconds)
        return try await extractFromDOM(in: webView, readabilityScript: readabilityScript)
    }

    @MainActor
    private func makeWebView(readabilityScript: String) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let trimmed = readabilityScript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let userScript = WKUserScript(
                source: trimmed,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
            configuration.userContentController.addUserScript(userScript)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isHidden = true
        webView.allowsBackForwardNavigationGestures = false
        return webView
    }
    
    @MainActor
    private func acquireWebView(readabilityScript: String) -> WKWebView {
        if let existing = webViewPool.popLast() {
            return existing
        }
        return makeWebView(readabilityScript: readabilityScript)
    }
    
    @MainActor
    private func releaseWebView(_ webView: WKWebView) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.loadHTMLString("", baseURL: nil)
        webViewPool.append(webView)
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

                // readyState 完成且正文/媒体稳定即可开始抽取，避免等待过久。
                if stableTicks >= 2,
                   sample.readyState.lowercased() == "complete",
                   sample.textLen >= stabilizationMinTextLength {
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
    private func extractFromDOM(
        in webView: WKWebView,
        readabilityScript: String
    ) async throws -> (title: String?, author: String?, contentHTML: String, textContent: String) {
        try await ensureReadabilityLoaded(in: webView, readabilityScript: readabilityScript)

        let script = #"""
        (() => {
          try {
            // WeChat: js_content 默认隐藏，正文已在 HTML 中，直接解除隐藏，避免 Readability 误判“不可见”。
            const wechat = document.querySelector('#js_content');
            if (wechat) {
              wechat.style.visibility = 'visible';
              wechat.style.opacity = '1';
            }

            // 移除明显无关/误导的 a11y 提示节点（避免“只剩一行字”的假象）
            const a11y = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
            a11y.forEach(n => n && n.remove());

            if (typeof Readability !== 'function') {
              return JSON.stringify({ ok: false, error: 'ReadabilityNotLoaded' });
            }

            const cloned = document.cloneNode(true);
            const article = new Readability(cloned).parse();
            if (!article) {
              return JSON.stringify({ ok: false, error: 'ParseReturnedNull' });
            }

            const title = (article.title || '').trim();
            const author = (article.byline || '').trim();
            const content = (article.content || '').trim();
            const text = (article.textContent || '').trim();

            return JSON.stringify({ ok: true, title, author, content, text });
          } catch (e) {
            const message = (e && (e.message || e.toString())) ? (e.message || e.toString()) : 'UnknownError';
            return JSON.stringify({ ok: false, error: message });
          }
        })();
        """#

        let any = try await evaluateJavaScript(in: webView, script: script)
        guard let json = any as? String else {
            throw URLFetchError.parsingFailed
        }

        struct Payload: Decodable {
            let ok: Bool
            let error: String?
            let title: String?
            let author: String?
            let content: String?
            let text: String?
        }

        guard let data = json.data(using: .utf8),
              let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
            throw URLFetchError.parsingFailed
        }

        guard payload.ok else {
            throw URLFetchError.parsingFailed
        }

        let content = (payload.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = (payload.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !text.isEmpty else {
            throw URLFetchError.contentNotFound
        }

        let html: String
        if !content.isEmpty {
            html = "<html><body>\(content)</body></html>"
        } else {
            html = "<html><body><p>\(escapeHTML(text))</p></body></html>"
        }

        let normalizedTitle = payload.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedAuthor = payload.author?.trimmingCharacters(in: .whitespacesAndNewlines)

        return (
            title: (normalizedTitle?.isEmpty == true) ? nil : normalizedTitle,
            author: (normalizedAuthor?.isEmpty == true) ? nil : normalizedAuthor,
            contentHTML: html.isEmpty ? "<html><body></body></html>" : html,
            textContent: text
        )
    }

    // MARK: - Readability

    @MainActor
    private func ensureReadabilityLoaded(in webView: WKWebView, readabilityScript: String) async throws {
        let check = "typeof Readability === 'function'"
        if let ok = try? await evaluateJavaScript(in: webView, script: check) as? Bool, ok == true {
            return
        }

        let trimmed = readabilityScript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw URLFetchError.parsingFailed
        }
        _ = try await evaluateJavaScript(in: webView, script: trimmed)
    }

    private func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
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
