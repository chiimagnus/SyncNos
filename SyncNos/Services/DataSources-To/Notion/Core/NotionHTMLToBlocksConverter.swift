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

/// 将文章 HTML 转为 Notion blocks（保序 + 基础结构 + 图片 file_upload）
final class NotionHTMLToBlocksConverter: NotionHTMLToBlocksConverterProtocol, @unchecked Sendable {

    // MARK: - Types

    fileprivate struct DOMItem: Decodable, Sendable {
        struct Segment: Decodable, Sendable {
            struct Marks: Decodable, Sendable {
                let bold: Bool?
                let italic: Bool?
                let code: Bool?
                let href: String?
            }

            let text: String
            let marks: Marks?
        }

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
        let segments: [Segment]?
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


    private actor ImageUploadCache {
        private var cache: [String: String] = [:]

        func get(_ url: String) -> String? {
            cache[url]
        }

        func set(_ url: String, id: String) {
            cache[url] = id
        }
    }

    // MARK: - Dependencies
    private let notionService: NotionServiceProtocol
    private let logger: LoggerServiceProtocol
    private let imageUploadCache = ImageUploadCache()

    init(
        notionService: NotionServiceProtocol,
        logger: LoggerServiceProtocol
    ) {
        self.notionService = notionService
        self.logger = logger
    }

    // MARK: - Limits

    /// Notion 单个 block 的 rich_text 数量存在上限；这里留足安全余量，避免触发 API 校验失败。
    private static let maxRichTextItemsPerBlock: Int = 80
    private static let maxLinkURLLength: Int = 2000
    private static let allowedImageSchemes: Set<String> = ["http", "https"]

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

        return await buildBlocks(from: domItems)
    }

    // MARK: - Build blocks

    private func buildBlocks(from items: [DOMItem]) async -> [[String: Any]] {
        var blocks: [[String: Any]] = []
        blocks.reserveCapacity(items.count)

        for item in items {
            switch item.type {
            case .img:
                if let src = item.src?.trimmingCharacters(in: .whitespacesAndNewlines), !src.isEmpty {
                    blocks.append(await makeImageBlock(urlString: src))
                }

            case .hr:
                blocks.append([
                    "object": "block",
                    "divider": [:]
                ])

            case .h1:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_1", item: item))
            case .h2:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_2", item: item))
            case .h3:
                blocks.append(contentsOf: makeTextBlocks(type: "heading_3", item: item))
            case .p:
                blocks.append(contentsOf: makeTextBlocks(type: "paragraph", item: item))
            case .blockquote:
                blocks.append(contentsOf: makeTextBlocks(type: "quote", item: item))
            case .ul_li:
                blocks.append(contentsOf: makeTextBlocks(type: "bulleted_list_item", item: item))
            case .ol_li:
                blocks.append(contentsOf: makeTextBlocks(type: "numbered_list_item", item: item))
            }
        }

        return blocks
    }

    private func makeTextBlocks(type: String, item: DOMItem) -> [[String: Any]] {
        if let segments = item.segments, !segments.isEmpty {
            return makeTextBlocksFromSegments(type: type, segments: segments)
        }

        let normalized = (item.text ?? "")
            .replacingOccurrences(of: "\r\n", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalized.isEmpty else { return [] }

        // 回退：纯文本
        return makeTextBlocksFromPlainText(type: type, text: normalized)
    }

    private func makeTextBlocksFromPlainText(type: String, text: String) -> [[String: Any]] {
        let helperMethods = NotionHelperMethods()
        let chunks = helperMethods.chunkText(text, chunkSize: NotionSyncConfig.maxTextLengthPrimary)
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

    private func makeTextBlocksFromSegments(type: String, segments: [DOMItem.Segment]) -> [[String: Any]] {
        let normalizedSegments = normalizeSegments(segments)
        guard !normalizedSegments.isEmpty else { return [] }

        let chunked = chunkSegments(
            normalizedSegments,
            chunkSize: NotionSyncConfig.maxTextLengthPrimary,
            maxItems: Self.maxRichTextItemsPerBlock
        )
        return chunked.map { segmentChunk in
            [
                "object": "block",
                type: [
                    "rich_text": segmentChunk.map { makeRichText(from: $0) }
                ]
            ]
        }
    }

    private func normalizeSegments(_ segments: [DOMItem.Segment]) -> [DOMItem.Segment] {
        // 去掉空文本，并合并相邻 marks 相同的片段（降低 rich_text 数量）
        var result: [DOMItem.Segment] = []
        for segment in segments {
            var text = segment.text.replacingOccurrences(of: "\r\n", with: "\n")
            // 兜底：删除非法的空字符，避免 Notion API 校验失败
            text = text.replacingOccurrences(of: "\u{0000}", with: "")
            // 折叠多余空白，保留必要的分隔（避免 words 粘连）
            text = text.replacingOccurrences(of: "\\s+", with: " ", options: [.regularExpression])
            guard !text.isEmpty else { continue }

            if let last = result.last, marksEqual(last.marks, segment.marks) {
                result[result.count - 1] = DOMItem.Segment(
                    text: last.text + text,
                    marks: last.marks
                )
            } else {
                result.append(DOMItem.Segment(text: text, marks: segment.marks))
            }
        }

        // 如果整体只有空白（trim 后为空），直接返回空
        let allText = result.map(\.text).joined()
        if allText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return []
        }
        return result
    }

    private func marksEqual(_ a: DOMItem.Segment.Marks?, _ b: DOMItem.Segment.Marks?) -> Bool {
        (a?.bold ?? false) == (b?.bold ?? false)
            && (a?.italic ?? false) == (b?.italic ?? false)
            && (a?.code ?? false) == (b?.code ?? false)
            && (a?.href ?? "") == (b?.href ?? "")
    }

    private func chunkSegments(_ segments: [DOMItem.Segment], chunkSize: Int, maxItems: Int) -> [[DOMItem.Segment]] {
        var chunks: [[DOMItem.Segment]] = []
        var current: [DOMItem.Segment] = []
        var currentCount = 0

        func flushIfNeeded(force: Bool = false) {
            if force || ((currentCount >= chunkSize || current.count >= maxItems) && !current.isEmpty) {
                chunks.append(current)
                current = []
                currentCount = 0
            }
        }

        for segment in segments {
            var remainingText = segment.text
            while !remainingText.isEmpty {
                if current.count >= maxItems {
                    flushIfNeeded(force: true)
                }
                let spaceLeft = max(1, chunkSize - currentCount)
                if remainingText.count <= spaceLeft {
                    current.append(DOMItem.Segment(text: remainingText, marks: segment.marks))
                    currentCount += remainingText.count
                    remainingText = ""
                    if currentCount >= chunkSize || current.count >= maxItems {
                        flushIfNeeded(force: true)
                    }
                } else {
                    let splitIndex = remainingText.index(remainingText.startIndex, offsetBy: spaceLeft)
                    let head = String(remainingText[..<splitIndex])
                    let tail = String(remainingText[splitIndex...])
                    current.append(DOMItem.Segment(text: head, marks: segment.marks))
                    currentCount += head.count
                    flushIfNeeded(force: true)
                    remainingText = tail
                }
            }
        }

        flushIfNeeded(force: !current.isEmpty)
        return chunks
    }

    private func makeRichText(from segment: DOMItem.Segment) -> [String: Any] {
        var textPayload: [String: Any] = ["content": segment.text]
        if let href = sanitizedLinkURL(segment.marks?.href) {
            textPayload["link"] = ["url": href]
        }

        var richText: [String: Any] = ["text": textPayload]
        var annotations: [String: Any] = [:]
        if segment.marks?.bold == true { annotations["bold"] = true }
        if segment.marks?.italic == true { annotations["italic"] = true }
        if segment.marks?.code == true { annotations["code"] = true }
        if !annotations.isEmpty {
            richText["annotations"] = annotations
        }
        return richText
    }

    private func sanitizedLinkURL(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        // Notion 对 URL 校验较严格：这里仅保留 http/https，避免 javascript/mailto 等导致整页同步失败
        guard raw.count <= Self.maxLinkURLLength else { return nil }
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { return nil }
        guard scheme == "http" || scheme == "https" else { return nil }
        return raw
    }

    private func upgradedToHTTPS(_ url: URL) -> URL {
        guard url.scheme?.lowercased() == "http" else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = "https"
        return components?.url ?? url
    }

    private func makeImageBlock(urlString: String) async -> [String: Any] {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              Self.allowedImageSchemes.contains(scheme) else {
            return makeExternalImageBlock(urlString: urlString)
        }

        let uploadURL = upgradedToHTTPS(url)
        let cacheKey = uploadURL.absoluteString
        if let cachedId = await imageUploadCache.get(cacheKey) {
            return makeFileUploadImageBlock(id: cachedId)
        }

        do {
            let fileUploadId = try await notionService.importImageFromExternalURL(
                url: uploadURL,
                filename: nil,
                contentType: nil
            )
            await imageUploadCache.set(cacheKey, id: fileUploadId)
            return makeFileUploadImageBlock(id: fileUploadId)
        } catch {
            logger.warning("[NotionHTMLToBlocks] Image import failed for \(urlString): \(error.localizedDescription)")
            return makeExternalImageBlock(urlString: urlString)
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

    private func makeFileUploadImageBlock(id: String) -> [String: Any] {
        [
            "object": "block",
            "image": [
                "type": "file_upload",
                "file_upload": [
                    "id": id
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
          const root = document.querySelector('article') || document.querySelector('main') || document.body;
          const selector = 'h1,h2,h3,p,blockquote,li,hr,img,pre,figcaption,section,div';
          const nodes = Array.from(root.querySelectorAll(selector));

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
            const inner = (el.innerText || '').trim();
            if (inner) return inner;
            return (el.textContent || '').trim();
          }

          function isWhitespaceText(text) {
            return !text || !String(text).replace(/\s+/g, '').length;
          }

          function mergeSegments(segments) {
            const merged = [];
            for (const seg of segments) {
              if (!seg || isWhitespaceText(seg.text)) continue;
              const last = merged.length ? merged[merged.length - 1] : null;
              const a = last ? (last.marks || {}) : {};
              const b = seg.marks || {};
              const same =
                (a.bold ? true : false) === (b.bold ? true : false) &&
                (a.italic ? true : false) === (b.italic ? true : false) &&
                (a.code ? true : false) === (b.code ? true : false) &&
                String(a.href || '') === String(b.href || '');
              if (last && same) {
                last.text += seg.text;
              } else {
                merged.push({
                  text: seg.text,
                  marks: Object.keys(b).length ? b : undefined
                });
              }
            }
            return merged;
          }

          function segmentsFromNode(node, marks) {
            const out = [];
            if (!node) return out;

            const m = marks || {};
            const nodeType = node.nodeType;

            // Text node
            if (nodeType === 3) {
              const txt = node.nodeValue || '';
              if (!isWhitespaceText(txt)) {
                out.push({ text: txt, marks: Object.keys(m).length ? m : undefined });
              }
              return out;
            }

            // Element node
            if (nodeType !== 1) return out;

            const tag = (node.tagName || '').toLowerCase();
            if (tag === 'br') {
              out.push({ text: '\n', marks: Object.keys(m).length ? m : undefined });
              return out;
            }

            // 标注：a/b/strong/em/i/code
            let nextMarks = m;
            if (tag === 'a') {
              const href = node.getAttribute('href');
              if (href) {
                try {
                  const abs = new URL(href, document.baseURI).href;
                  nextMarks = Object.assign({}, nextMarks, { href: abs });
                } catch (e) {}
              }
            } else if (tag === 'strong' || tag === 'b') {
              nextMarks = Object.assign({}, nextMarks, { bold: true });
            } else if (tag === 'em' || tag === 'i') {
              nextMarks = Object.assign({}, nextMarks, { italic: true });
            } else if (tag === 'code') {
              nextMarks = Object.assign({}, nextMarks, { code: true });
            }

            for (const child of Array.from(node.childNodes || [])) {
              out.push(...segmentsFromNode(child, nextMarks));
            }
            return out;
          }

          function segmentsOf(el) {
            if (!el) return [];
            // 对 block 元素，直接从子节点生成 segments，避免 innerText 丢失 inline 标注
            const segs = segmentsFromNode(el, {});
            return mergeSegments(segs);
          }

          function pickImageURL(img) {
            if (!img) return null;
            const candidates = [
              img.getAttribute('data-src'),
              img.getAttribute('data-original'),
              img.getAttribute('data-lazy-src'),
              img.getAttribute('data-url'),
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
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (segs.length) results.push({ type: tag, segments: segs, text: t });
              else if (t) results.push({ type: tag, text: t });
              continue;
            }
            if (tag === 'p') {
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (segs.length) results.push({ type: 'p', segments: segs, text: t });
              else if (t) results.push({ type: 'p', text: t });
              continue;
            }
            if (tag === 'blockquote') {
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (segs.length) results.push({ type: 'blockquote', segments: segs, text: t });
              else if (t) results.push({ type: 'blockquote', text: t });
              continue;
            }
            if (tag === 'li') {
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (!t && !segs.length) continue;
              const parent = el.parentElement ? (el.parentElement.tagName || '').toLowerCase() : '';
              if (parent === 'ol') results.push({ type: 'ol_li', segments: segs.length ? segs : undefined, text: t });
              else results.push({ type: 'ul_li', segments: segs.length ? segs : undefined, text: t });
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
            if (tag === 'pre' || tag === 'figcaption') {
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (segs.length) results.push({ type: 'p', segments: segs, text: t });
              else if (t) results.push({ type: 'p', text: t });
              continue;
            }
            if (tag === 'div' || tag === 'section') {
              // 兜底：部分站点正文不使用 <p>，而是 div/section + inline 文本
              // 只处理“叶子容器”，避免把整块内容重复输出
              if (el.getAttribute('aria-hidden') === 'true') continue;
              if (isInside(el, 'p') || isInside(el, 'blockquote') || isInside(el, 'li')) continue;
              if (el.querySelector('div,section,h1,h2,h3,p,blockquote,li,hr,img,pre,figcaption')) continue;
              const segs = segmentsOf(el);
              const t = textOf(el);
              if (segs.length) results.push({ type: 'p', segments: segs, text: t });
              else if (t) results.push({ type: 'p', text: t });
              continue;
            }
          }

          return JSON.stringify(results);
        })();
        """#
    }
}
