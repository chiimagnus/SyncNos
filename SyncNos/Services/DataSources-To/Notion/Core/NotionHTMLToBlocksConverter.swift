import Foundation
import WebKit

// MARK: - Protocol

protocol NotionHTMLToBlocksConverterProtocol: Sendable {
    func convertArticleHTMLToBlocks(
        html: String,
        baseURL: URL
    ) async throws -> [[String: Any]]
}

// MARK: - Converter

/// 将文章 HTML 转为 Notion blocks（MVP：保序 + 基础结构 + 图片 external）
final class NotionHTMLToBlocksConverter: NotionHTMLToBlocksConverterProtocol {

    // MARK: - Types

    fileprivate struct DOMItem: Decodable, Sendable {
        enum ItemType: String, Decodable, Sendable {
            case h1
            case h2
            case h3
            case p
            case blockquote
            case ul_li
            case ol_li
            case hr
            case img
        }

        let type: ItemType
        let text: String?
        let src: String?
    }

    enum ConversionError: LocalizedError {
        case emptyHTML
        case javaScriptReturnedUnexpectedType
        case failedToDecodeDOMItems(String)

        var errorDescription: String? {
            switch self {
            case .emptyHTML:
                return "Empty HTML"
            case .javaScriptReturnedUnexpectedType:
                return "JavaScript returned unexpected type"
            case .failedToDecodeDOMItems(let message):
                return "Failed to decode DOM items: \(message)"
            }
        }
    }

    // MARK: - Dependencies
    init() {}

    // MARK: - NotionHTMLToBlocksConverterProtocol

    func convertArticleHTMLToBlocks(
        html: String,
        baseURL: URL
    ) async throws -> [[String: Any]] {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw ConversionError.emptyHTML
        }

        let domItems = try await WebKitDOMExtractor.extractDOMItems(fromHTML: trimmed, baseURL: baseURL)

        return buildBlocks(from: domItems)
    }

    // MARK: - Build blocks

    private func buildBlocks(from items: [DOMItem]) -> [[String: Any]] {
        var blocks: [[String: Any]] = []
        blocks.reserveCapacity(items.count)

        for item in items {
            switch item.type {
            case .img:
                if let src = item.src?.trimmingCharacters(in: .whitespacesAndNewlines), !src.isEmpty {
                    blocks.append(makeExternalImageBlock(urlString: src))
                }

            case .hr:
                blocks.append([
                    "object": "block",
                    "divider": [:]
                ])

            case .h1:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_1", text: item.text))
            case .h2:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_2", text: item.text))
            case .h3:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_3", text: item.text))
            case .p:
                blocks.append(contentsOf: makeTextBlocks(type: "paragraph", text: item.text))
            case .blockquote:
                blocks.append(contentsOf: makeTextBlocks(type: "quote", text: item.text))
            case .ul_li:
                blocks.append(contentsOf: makeTextBlocks(type: "bulleted_list_item", text: item.text))
            case .ol_li:
                blocks.append(contentsOf: makeTextBlocks(type: "numbered_list_item", text: item.text))
            }
        }

        return blocks
    }

    private func makeTextBlocks(type: String, text: String?) -> [[String: Any]] {
        let normalized = (text ?? "")
            .replacingOccurrences(of: "\r\n", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalized.isEmpty else { return [] }

        let helperMethods = NotionHelperMethods()
        let chunks = helperMethods.chunkText(normalized, chunkSize: NotionSyncConfig.maxTextLengthPrimary)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        return chunks.map { chunk in
            [
                "object": "block",
                type: [
                    "rich_text": [
                        ["text": ["content": chunk]]
                    ]
                ]
            ]
        }
    }

    private func makeExternalImageBlock(urlString: String) -> [String: Any] {
        [
            "object": "block",
            "image": [
                "type": "external",
                "external": [
                    "url": urlString
                ]
            ]
        ]
    }
}

// MARK: - WebKit DOM Extractor

@MainActor
private enum WebKitDOMExtractor {

    private static let contentBlockerIdentifier = "SyncNos.NotionHTMLToBlocksConverter.Blocker"

    static func extractDOMItems(fromHTML html: String, baseURL: URL) async throws -> [NotionHTMLToBlocksConverter.DOMItem] {
        let webView = try await makeWebView()
        try await loadHTML(in: webView, html: html, baseURL: baseURL)
        let jsonStringAny = try await evaluateJavaScript(in: webView, script: extractionScript())

        guard let jsonString = jsonStringAny as? String else {
            throw NotionHTMLToBlocksConverter.ConversionError.javaScriptReturnedUnexpectedType
        }

        let data = Data(jsonString.utf8)
        do {
            return try JSONDecoder().decode([NotionHTMLToBlocksConverter.DOMItem].self, from: data)
        } catch {
            throw NotionHTMLToBlocksConverter.ConversionError.failedToDecodeDOMItems(error.localizedDescription)
        }
    }

    private static func makeWebView() async throws -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let userContentController = WKUserContentController()
        configuration.userContentController = userContentController

        // 尽量阻断外部子资源加载（减少隐私/追踪面，并提升解析稳定性）
        if let ruleList = try? await compileContentBlocker() {
            userContentController.add(ruleList)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isHidden = true
        return webView
    }

    private static func compileContentBlocker() async throws -> WKContentRuleList {
        try await withCheckedThrowingContinuation { continuation in
            let rules = """
            [
              {
                "trigger": { "url-filter": ".*", "resource-type": ["image", "style-sheet", "script", "font", "media"] },
                "action": { "type": "block" }
              }
            ]
            """
            WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: contentBlockerIdentifier,
                encodedContentRuleList: rules
            ) { list, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                if let list {
                    continuation.resume(returning: list)
                    return
                }
                continuation.resume(throwing: NSError(
                    domain: "NotionHTMLToBlocksConverter",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Failed to compile content blocker"]
                ))
            }
        }
    }

    private static func loadHTML(in webView: WKWebView, html: String, baseURL: URL) async throws {
        final class NavigationWaiter: NSObject, WKNavigationDelegate {
            private var continuation: CheckedContinuation<Void, Error>?

            func waitForFinish() async throws {
                try await withCheckedThrowingContinuation { continuation in
                    self.continuation = continuation
                }
            }

            func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
                continuation?.resume()
                continuation = nil
            }

            func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
                continuation?.resume(throwing: error)
                continuation = nil
            }

            func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
                continuation?.resume(throwing: error)
                continuation = nil
            }
        }

        let waiter = NavigationWaiter()
        webView.navigationDelegate = waiter
        _ = webView.loadHTMLString(html, baseURL: baseURL)
        try await waiter.waitForFinish()
        webView.navigationDelegate = nil
    }

    private static func evaluateJavaScript(in webView: WKWebView, script: String) async throws -> Any {
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

    private static func extractionScript() -> String {
        // 返回 JSON 字符串，Swift 侧再 decode
        #"""
        (() => {
          const results = [];
          const selector = 'h1,h2,h3,p,blockquote,li,hr,img';
          const nodes = Array.from(document.body.querySelectorAll(selector));

          function isInside(el, tagName) {
            let p = el.parentElement;
            while (p) {
              if (p.tagName && p.tagName.toLowerCase() === tagName) return true;
              p = p.parentElement;
            }
            return false;
          }

          function textOf(el) {
            if (!el) return '';
            return (el.innerText || el.textContent || '').trim();
          }

          function pickImageURL(img) {
            if (!img) return null;
            const candidates = [
              img.getAttribute('data-src'),
              img.getAttribute('data-original'),
              img.getAttribute('data-lazy-src'),
              img.getAttribute('src')
            ].filter(Boolean);

            let raw = candidates.length ? candidates[0] : null;

            if (!raw) {
              const srcset = img.getAttribute('srcset');
              if (srcset) {
                const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
                let best = null;
                let bestScore = -1;
                for (const part of parts) {
                  const segs = part.split(/\s+/).filter(Boolean);
                  if (!segs.length) continue;
                  const url = segs[0];
                  const desc = segs[1] || '';
                  let score = 0;
                  if (desc.endsWith('w')) score = parseInt(desc.replace('w', ''), 10) || 0;
                  else if (desc.endsWith('x')) score = Math.round((parseFloat(desc.replace('x', '')) || 0) * 1000);
                  if (score > bestScore) {
                    bestScore = score;
                    best = url;
                  }
                }
                raw = best || null;
              }
            }

            if (!raw) return null;
            raw = String(raw).trim();
            if (!raw || raw.startsWith('data:')) return null;

            try {
              return new URL(raw, document.baseURI).href;
            } catch (e) {
              return null;
            }
          }

          for (const el of nodes) {
            const tag = (el.tagName || '').toLowerCase();

            // 避免重复：blockquote 内的 p、li 内的 p 等，统一由外层 block 承担
            if (tag === 'p' && (isInside(el, 'blockquote') || isInside(el, 'li'))) continue;

            if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
              const t = textOf(el);
              if (t) results.push({ type: tag, text: t });
              continue;
            }
            if (tag === 'p') {
              const t = textOf(el);
              if (t) results.push({ type: 'p', text: t });
              continue;
            }
            if (tag === 'blockquote') {
              const t = textOf(el);
              if (t) results.push({ type: 'blockquote', text: t });
              continue;
            }
            if (tag === 'li') {
              const t = textOf(el);
              if (!t) continue;
              const parent = el.parentElement ? (el.parentElement.tagName || '').toLowerCase() : '';
              if (parent === 'ol') results.push({ type: 'ol_li', text: t });
              else results.push({ type: 'ul_li', text: t });
              continue;
            }
            if (tag === 'hr') {
              results.push({ type: 'hr' });
              continue;
            }
            if (tag === 'img') {
              const url = pickImageURL(el);
              if (url) results.push({ type: 'img', src: url });
              continue;
            }
          }

          return JSON.stringify(results);
        })();
        """#
    }
}
