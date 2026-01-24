import SwiftUI

// MARK: - Article Load State

/// 文章内容加载状态（驱动 ArticleContentCardView 渲染）
enum ArticleLoadState: Equatable {
    /// 未加载（初始状态，预览自动加载中）
    case notLoaded
    /// 预览状态（显示前 N 个字符，等待用户展开加载完整内容）
    case preview(content: String, wordCount: Int)
    /// 正在加载完整内容
    case loadingFull
    /// 已加载完整内容（纯文本）
    case loaded(content: String, wordCount: Int)
    /// 已加载完整内容（HTML）
    case loadedHTML(html: String, baseURL: URL?, wordCount: Int)
    /// 已加载但无内容
    case empty
    /// 加载失败
    case error(message: String)
    
    var isLoaded: Bool {
        if case .loaded = self { return true }
        if case .loadedHTML = self { return true }
        return false
    }
    
    var isPreview: Bool {
        if case .preview = self { return true }
        return false
    }
    
    // 实现 Equatable（手动）
    static func == (lhs: ArticleLoadState, rhs: ArticleLoadState) -> Bool {
        switch (lhs, rhs) {
        case (.notLoaded, .notLoaded):
            return true
        case (.preview(let c1, let w1), .preview(let c2, let w2)):
            return c1 == c2 && w1 == w2
        case (.loadingFull, .loadingFull):
            return true
        case (.loaded(let c1, let w1), .loaded(let c2, let w2)):
            return c1 == c2 && w1 == w2
        case (.loadedHTML(let h1, let u1, let w1), .loadedHTML(let h2, let u2, let w2)):
            return h1 == h2 && u1 == u2 && w1 == w2
        case (.empty, .empty):
            return true
        case (.error(let m1), .error(let m2)):
            return m1 == m2
        default:
            return false
        }
    }
}

// MARK: - Article Content Card View

/// 展示文章全文的内容卡片（状态驱动）。
/// 
/// 支持以下状态：
/// - `notLoaded`: 初始状态，显示加载指示器（预览自动加载）
/// - `preview`: 预览状态，显示前 N 个字符 + Expand 按钮
/// - `loadingFull`: 加载完整内容中
/// - `loaded`: 已加载完整内容 + Collapse 按钮
/// - `empty`: 无内容
/// - `error`: 加载失败，显示错误信息和重试按钮
struct ArticleContentCardView: View {
    // MARK: - Properties
    
    /// 加载状态
    let loadState: ArticleLoadState
    
    /// 父组件控制的展开状态（双向绑定）
    @Binding var isExpanded: Bool
    
    /// 可选：覆盖宽度（用于 live resize 冻结）
    let overrideWidth: CGFloat?
    
    /// 输出当前测量宽度
    @Binding var measuredWidth: CGFloat
    
    /// 折叠时显示的行数
    let collapsedLineLimit: Int
    
    /// 重试回调（仅 error 状态使用）
    let onRetry: (() async -> Void)?
    
    // MARK: - Initialization
    
    init(
        loadState: ArticleLoadState,
        isExpanded: Binding<Bool>,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        onRetry: (() async -> Void)? = nil
    ) {
        self.loadState = loadState
        self._isExpanded = isExpanded
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.onRetry = onRetry
    }
    
    // MARK: - Body
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header (包含展开/折叠按钮)
            headerSection
            
            // Content (根据状态渲染)
            contentSection
        }
        .overlay(widthMeasurer)
        .frame(maxWidth: overrideWidth, alignment: .leading)
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.text.fill")
                .scaledFont(.headline)
                .foregroundColor(.secondary)
            
            Text("Article")
                .scaledFont(.headline)
                .foregroundColor(.primary)
            
            Text("\(wordCount) words")
                .scaledFont(.caption)
                .foregroundColor(.secondary)
            
            Spacer()
            
            // 展开/折叠按钮（放在标题栏右侧）
            if shouldShowToggle {
                toggleButton
            }
        }
        .padding(.bottom, 4)
    }
    
    // MARK: - Content Section
    
    @ViewBuilder
    private var contentSection: some View {
        Group {
            switch loadState {
            case .notLoaded:
                notLoadedContent
                
            case .preview(let content, _):
                previewContent(content)
                
            case .loadingFull:
                loadingFullContent
                
            case .loaded(let content, _):
                loadedContent(content)
                
            case .loadedHTML(let html, let baseURL, _):
                loadedHTMLContent(html: html, baseURL: baseURL)
                
            case .empty:
                emptyContent
                
            case .error(let message):
                errorContent(message: message)
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
        )
    }
    
    // MARK: - State-specific Content Views
    
    /// 加载中状态（预览自动加载）
    private var notLoadedContent: some View {
        HStack(spacing: 8) {
            ProgressView()
                .scaleEffect(0.8)
            Text("Loading...")
                .scaledFont(.body)
                .foregroundColor(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
    
    /// 预览状态：显示预览内容，提示用户展开查看完整内容
    private func previewContent(_ content: String) -> some View {
        Text(content)
            .scaledFont(.body)
            .foregroundColor(.primary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
    
    /// 正在加载完整内容
    private var loadingFullContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ProgressView()
                    .scaleEffect(0.8)
                Text("Loading full content...")
                    .scaledFont(.body)
                    .foregroundColor(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
    
    private func loadedContent(_ content: String) -> some View {
        Text(content)
            .scaledFont(.body)
            .foregroundColor(.primary)
            .textSelection(.enabled)
            .lineLimit(isExpanded ? nil : collapsedLineLimit)
            .fixedSize(horizontal: false, vertical: isExpanded)
    }
    
    /// 加载 HTML 内容（使用 WebView 渲染）
    private func loadedHTMLContent(html: String, baseURL: URL?) -> some View {
        Group {
            if isExpanded {
                // 展开时显示完整的 HTML 内容
                HTMLWebView(html: html, baseURL: baseURL)
                    .frame(minHeight: 400)
            } else {
                // 折叠时显示纯文本预览（提取前 N 个字符）
                Text(extractPlainText(from: html))
                    .scaledFont(.body)
                    .foregroundColor(.primary)
                    .textSelection(.enabled)
                    .lineLimit(collapsedLineLimit)
                    .fixedSize(horizontal: false, vertical: false)
            }
        }
    }
    
    /// 从 HTML 中提取纯文本（用于折叠预览）
    private func extractPlainText(from html: String) -> String {
        // 简单的纯文本提取：移除所有 HTML 标签
        let pattern = "<[^>]+>"
        let plainText = html.replacingOccurrences(
            of: pattern,
            with: " ",
            options: .regularExpression
        )
        
        // 清理多余空白
        let cleaned = plainText
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        
        // 截取前 500 字符作为预览
        if cleaned.count > 500 {
            return String(cleaned.prefix(500)) + "..."
        }
        return cleaned
    }
    
    private var emptyContent: some View {
        Text("No article content detected.")
            .scaledFont(.body)
            .foregroundColor(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
    
    private func errorContent(message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.orange)
                Text("Failed to load article content")
                    .scaledFont(.body)
                    .foregroundColor(.primary)
            }
            
            Text(message)
                .scaledFont(.caption)
                .foregroundColor(.secondary)
            
            if onRetry != nil {
                Button {
                    Task {
                        await onRetry?()
                    }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                        .scaledFont(.caption)
                }
                .buttonStyle(.bordered)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
    
    // MARK: - Toggle Button
    
    private var toggleButton: some View {
        Button(action: { isExpanded.toggle() }) {
            HStack(spacing: 6) {
                Text(isExpanded ? "Collapse" : "Expand")
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .imageScale(.small)
            }
            .scaledFont(.caption)
        }
        .buttonStyle(.link)
    }
    
    // MARK: - Width Measurer
    
    private var widthMeasurer: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            Color.clear
                .onAppear { measuredWidth = w }
                .onChange(of: w) { _, newValue in
                    measuredWidth = newValue
                }
        }
    }
    
    // MARK: - Computed Properties
    
    private var wordCount: Int {
        switch loadState {
        case .preview(_, let count), .loaded(_, let count), .loadedHTML(_, _, let count):
            return count
        default:
            return 0
        }
    }
    
    private var shouldShowToggle: Bool {
        switch loadState {
        case .notLoaded:
            // 未加载时不显示按钮
            return false
        case .preview:
            // 预览时显示 Expand 按钮
            return true
        case .loadingFull:
            // 加载完整内容中显示 Collapse 按钮
            return true
        case .loaded(let content, _):
            // 已加载完整内容时显示 Collapse 按钮（内容足够长时）
            return content.count > 200
        case .loadedHTML:
            // HTML 内容始终显示展开/折叠按钮
            return true
        case .empty:
            // 空内容时不显示按钮（没有内容可以展开/折叠）
            return false
        case .error:
            // 错误时不显示按钮
            return false
        }
    }
}
