import SwiftUI

// MARK: - Article Load State

/// 文章内容加载状态（驱动 ArticleContentCardView 渲染）
enum ArticleLoadState: Equatable {
    /// 未加载（折叠状态，等待用户展开）
    case notLoaded
    /// 预览状态（显示前 N 个字符，等待用户展开加载完整内容）
    case preview(content: String, wordCount: Int)
    /// 正在加载完整内容
    case loadingFull
    /// 已加载完整内容
    case loaded(content: String, wordCount: Int)
    /// 已加载但无内容（需要用户在 GoodLinks 中重新下载）
    case empty(openURL: URL?)
    /// 加载失败
    case error(message: String)
    
    var isLoaded: Bool {
        if case .loaded = self { return true }
        return false
    }
    
    var isPreview: Bool {
        if case .preview = self { return true }
        return false
    }
}

// MARK: - Article Content Card View

/// 展示文章全文的内容卡片（状态驱动）。
/// 
/// 支持以下状态：
/// - `notLoaded`: 折叠状态，显示"点击展开"提示
/// - `loading`: 加载中，显示 ProgressView
/// - `loaded`: 已加载，显示全文内容（可折叠/展开）
/// - `empty`: 无内容，提示用户在 GoodLinks 中重新下载
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
                
            case .empty(let openURL):
                emptyContent(openURL: openURL)
                
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
    
    private var notLoadedContent: some View {
        Text("Click \"Expand\" to load article content")
            .scaledFont(.body)
            .foregroundColor(.secondary)
            .italic()
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
    
    private func emptyContent(openURL: URL?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("No article content detected. Please")
                .scaledFont(.body)
                .foregroundColor(.secondary)
            if let url = openURL {
                Link("Open in GoodLinks", destination: url)
                    .scaledFont(.body)
                    .foregroundColor(.blue)
            }
            Text("and re-download this article.")
                .scaledFont(.body)
                .foregroundColor(.secondary)
        }
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
        case .preview(_, let count), .loaded(_, let count):
            return count
        default:
            return 0
        }
    }
    
    private var shouldShowToggle: Bool {
        switch loadState {
        case .notLoaded:
            // 未加载时不显示按钮（应该自动加载预览）
            return false
        case .preview:
            // 预览时显示 Expand 按钮
            return true
        case .loadingFull:
            // 加载完整内容中显示 Collapse 按钮（允许用户取消）
            return true
        case .loaded(let content, _):
            // 已加载完整内容时显示 Collapse 按钮
            return content.count > 200
        case .empty:
            // 空内容时显示 Collapse 按钮
            return true
        case .error:
            // 错误时显示 Collapse 按钮
            return true
        }
    }
}
