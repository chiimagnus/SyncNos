import Foundation
import WebKit

// MARK: - Protocol

/// HTML 转 Notion blocks 转换器协议
protocol NotionHTMLToBlocksConverterProtocol: Sendable {
    /// 将 HTML 文章内容转换为 Notion blocks 数组
    /// - Parameters:
    ///   - html: HTML 字符串（文章内容）
    ///   - baseURL: 基准 URL（用于解析相对链接和图片）
    /// - Returns: Notion blocks 数组，每个 block 是一个字典
    func convertArticleHTMLToBlocks(
        html: String,
        baseURL: URL
    ) async throws -> [[String: Any]]
}

// MARK: - DOM Node Structure

/// 从 JavaScript 提取的 DOM 节点结构
struct DOMNode: Codable {
    let type: String  // "h1", "h2", "h3", "p", "img", "ul_li", "ol_li", "blockquote", "hr"
    let text: String? // 文本内容（对于文本节点）
    let src: String?  // 图片 URL（对于 img 节点）
}

// MARK: - Implementation

/// WebKit 基础的 HTML 转 Notion blocks 转换器
@MainActor
final class NotionHTMLToBlocksConverter: NSObject, NotionHTMLToBlocksConverterProtocol {
    
    // MARK: - Dependencies
    
    private let logger: LoggerServiceProtocol
    
    // MARK: - State
    
    private var webView: WKWebView?
    private var continuation: CheckedContinuation<String, Error>?
    private var timeoutTask: Task<Void, Never>?
    
    // MARK: - Initialization
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
        super.init()
    }
    
    // MARK: - Protocol Implementation
    
    func convertArticleHTMLToBlocks(
        html: String,
        baseURL: URL
    ) async throws -> [[String: Any]] {
        logger.debug("[NotionHTMLConverter] Starting conversion for baseURL=\(baseURL.absoluteString)")
        
        // Step 1: 提取 DOM 结构为 JSON
        let domJSON = try await extractDOMStructure(html: html, baseURL: baseURL)
        
        // Step 2: 解码为 DOMNode 数组
        guard let jsonData = domJSON.data(using: .utf8) else {
            throw ConversionError.invalidJSON
        }
        
        let nodes: [DOMNode]
        do {
            nodes = try JSONDecoder().decode([DOMNode].self, from: jsonData)
        } catch {
            logger.error("[NotionHTMLConverter] Failed to decode DOM JSON: \(error.localizedDescription)")
            throw ConversionError.decodingFailed(error)
        }
        
        // Step 3: 将 DOMNode 数组映射为 Notion blocks
        let blocks = mapNodesToNotionBlocks(nodes: nodes)
        
        logger.info("[NotionHTMLConverter] Converted \(nodes.count) nodes to \(blocks.count) Notion blocks")
        return blocks
    }
    
    // MARK: - DOM Extraction
    
    /// 使用隐藏的 WKWebView 加载 HTML 并提取 DOM 结构
    private func extractDOMStructure(html: String, baseURL: URL) async throws -> String {
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            
            // 设置超时（30 秒）
            timeoutTask = Task {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if !Task.isCancelled {
                    self.handleExtractionFailure(error: ConversionError.timeout)
                }
            }
            
            // 创建隐藏的 WKWebView
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent() // 不需要持久化
            
            let webView = WKWebView(frame: .zero, configuration: config)
            webView.navigationDelegate = self
            self.webView = webView
            
            // 加载 HTML
            webView.loadHTMLString(html, baseURL: baseURL)
        }
    }
    
    /// 在 WebView 加载完成后执行 JavaScript 提取 DOM
    private func executeExtractionScript() {
        guard let webView = webView else { return }
        
        let script = """
        (function() {
            const result = [];
            const body = document.body;
            if (!body) return JSON.stringify(result);
            
            function processNode(node) {
                const tag = node.tagName?.toLowerCase();
                
                // 标题
                if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
                    const text = node.textContent?.trim() || '';
                    if (text) {
                        result.push({ type: tag, text: text });
                    }
                }
                // 段落
                else if (tag === 'p') {
                    const text = node.textContent?.trim() || '';
                    if (text) {
                        result.push({ type: 'p', text: text });
                    }
                }
                // 引用
                else if (tag === 'blockquote') {
                    const text = node.textContent?.trim() || '';
                    if (text) {
                        result.push({ type: 'blockquote', text: text });
                    }
                }
                // 分隔线
                else if (tag === 'hr') {
                    result.push({ type: 'hr' });
                }
                // 图片
                else if (tag === 'img') {
                    const src = node.getAttribute('src');
                    if (src) {
                        // 将相对 URL 转换为绝对 URL
                        try {
                            const absoluteURL = new URL(src, document.baseURI).href;
                            result.push({ type: 'img', src: absoluteURL });
                        } catch (e) {
                            // 无效 URL，跳过
                        }
                    }
                }
                // 无序列表项
                else if (tag === 'li' && node.parentElement?.tagName?.toLowerCase() === 'ul') {
                    const text = node.textContent?.trim() || '';
                    if (text) {
                        result.push({ type: 'ul_li', text: text });
                    }
                }
                // 有序列表项
                else if (tag === 'li' && node.parentElement?.tagName?.toLowerCase() === 'ol') {
                    const text = node.textContent?.trim() || '';
                    if (text) {
                        result.push({ type: 'ol_li', text: text });
                    }
                }
                // 递归处理子节点（对于容器元素）
                else if (['div', 'article', 'section', 'main', 'ul', 'ol'].includes(tag)) {
                    for (let child of node.children) {
                        processNode(child);
                    }
                }
            }
            
            // 遍历 body 的所有子节点
            for (let child of body.children) {
                processNode(child);
            }
            
            return JSON.stringify(result);
        })();
        """
        
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self = self else { return }
            
            if let error = error {
                self.handleExtractionFailure(error: ConversionError.scriptExecutionFailed(error))
                return
            }
            
            guard let jsonString = result as? String else {
                self.handleExtractionFailure(error: ConversionError.invalidScriptResult)
                return
            }
            
            self.handleExtractionSuccess(jsonString: jsonString)
        }
    }
    
    // MARK: - Handlers
    
    private func handleExtractionSuccess(jsonString: String) {
        timeoutTask?.cancel()
        timeoutTask = nil
        
        continuation?.resume(returning: jsonString)
        continuation = nil
        cleanup()
    }
    
    private func handleExtractionFailure(error: Error) {
        timeoutTask?.cancel()
        timeoutTask = nil
        
        continuation?.resume(throwing: error)
        continuation = nil
        cleanup()
    }
    
    private func cleanup() {
        webView?.navigationDelegate = nil
        webView = nil
    }
    
    // MARK: - Notion Blocks Mapping
    
    /// 将 DOMNode 数组映射为 Notion blocks
    private func mapNodesToNotionBlocks(nodes: [DOMNode]) -> [[String: Any]] {
        let helperMethods = NotionHelperMethods()
        let chunkSize = NotionSyncConfig.maxTextLengthPrimary
        var blocks: [[String: Any]] = []
        
        for node in nodes {
            switch node.type {
            case "h1":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildHeadingBlocks(text: text, level: 1, chunkSize: chunkSize))
                }
            case "h2":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildHeadingBlocks(text: text, level: 2, chunkSize: chunkSize))
                }
            case "h3":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildHeadingBlocks(text: text, level: 3, chunkSize: chunkSize))
                }
            case "p":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildParagraphBlocks(text: text, chunkSize: chunkSize))
                }
            case "blockquote":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildQuoteBlocks(text: text, chunkSize: chunkSize))
                }
            case "ul_li":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildBulletedListItemBlocks(text: text, chunkSize: chunkSize))
                }
            case "ol_li":
                if let text = node.text, !text.isEmpty {
                    blocks.append(contentsOf: buildNumberedListItemBlocks(text: text, chunkSize: chunkSize))
                }
            case "hr":
                blocks.append(buildDividerBlock())
            case "img":
                if let src = node.src, !src.isEmpty {
                    blocks.append(buildImageBlock(url: src))
                }
            default:
                // 未知类型，跳过
                logger.warning("[NotionHTMLConverter] Unknown node type: \(node.type)")
            }
        }
        
        return blocks
    }
    
    // MARK: - Block Builders
    
    /// 构建标题 blocks（支持分块）
    private func buildHeadingBlocks(text: String, level: Int, chunkSize: Int) -> [[String: Any]] {
        let chunks = chunkText(text, chunkSize: chunkSize)
        let blockType = "heading_\(level)"
        
        return chunks.map { chunk in
            [
                "object": "block",
                blockType: [
                    "rich_text": [["text": ["content": chunk]]]
                ]
            ]
        }
    }
    
    /// 构建段落 blocks（支持分块）
    private func buildParagraphBlocks(text: String, chunkSize: Int) -> [[String: Any]] {
        let chunks = chunkText(text, chunkSize: chunkSize)
        
        return chunks.map { chunk in
            [
                "object": "block",
                "paragraph": [
                    "rich_text": [["text": ["content": chunk]]]
                ]
            ]
        }
    }
    
    /// 构建引用 blocks（支持分块）
    private func buildQuoteBlocks(text: String, chunkSize: Int) -> [[String: Any]] {
        let chunks = chunkText(text, chunkSize: chunkSize)
        
        return chunks.map { chunk in
            [
                "object": "block",
                "quote": [
                    "rich_text": [["text": ["content": chunk]]]
                ]
            ]
        }
    }
    
    /// 构建无序列表项 blocks（支持分块）
    private func buildBulletedListItemBlocks(text: String, chunkSize: Int) -> [[String: Any]] {
        let chunks = chunkText(text, chunkSize: chunkSize)
        
        return chunks.map { chunk in
            [
                "object": "block",
                "bulleted_list_item": [
                    "rich_text": [["text": ["content": chunk]]]
                ]
            ]
        }
    }
    
    /// 构建有序列表项 blocks（支持分块）
    private func buildNumberedListItemBlocks(text: String, chunkSize: Int) -> [[String: Any]] {
        let chunks = chunkText(text, chunkSize: chunkSize)
        
        return chunks.map { chunk in
            [
                "object": "block",
                "numbered_list_item": [
                    "rich_text": [["text": ["content": chunk]]]
                ]
            ]
        }
    }
    
    /// 构建分隔线 block
    private func buildDividerBlock() -> [String: Any] {
        [
            "object": "block",
            "divider": [:]
        ]
    }
    
    /// 构建图片 block（使用 external URL）
    private func buildImageBlock(url: String) -> [String: Any] {
        [
            "object": "block",
            "image": [
                "type": "external",
                "external": [
                    "url": url
                ]
            ]
        ]
    }
    
    // MARK: - Text Chunking
    
    /// 文本分块（与 NotionHelperMethods.chunkText 一致）
    private func chunkText(_ text: String, chunkSize: Int) -> [String] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        var parts: [String] = []
        
        var start = normalized.startIndex
        while start < normalized.endIndex {
            let end = normalized.index(start, offsetBy: chunkSize, limitedBy: normalized.endIndex) ?? normalized.endIndex
            let slice = String(normalized[start..<end])
            parts.append(slice)
            start = end
        }
        
        if parts.isEmpty {
            return [""]
        }
        return parts
    }
}

// MARK: - WKNavigationDelegate

extension NotionHTMLToBlocksConverter: WKNavigationDelegate {
    
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            self.executeExtractionScript()
        }
    }
    
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            self.handleExtractionFailure(error: ConversionError.navigationFailed(error))
        }
    }
}

// MARK: - Errors

enum ConversionError: LocalizedError {
    case timeout
    case navigationFailed(Error)
    case scriptExecutionFailed(Error)
    case invalidScriptResult
    case invalidJSON
    case decodingFailed(Error)
    
    var errorDescription: String? {
        switch self {
        case .timeout:
            return "HTML conversion timed out"
        case .navigationFailed(let error):
            return "WebView navigation failed: \(error.localizedDescription)"
        case .scriptExecutionFailed(let error):
            return "JavaScript execution failed: \(error.localizedDescription)"
        case .invalidScriptResult:
            return "JavaScript returned invalid result"
        case .invalidJSON:
            return "Invalid JSON from DOM extraction"
        case .decodingFailed(let error):
            return "Failed to decode DOM structure: \(error.localizedDescription)"
        }
    }
}
