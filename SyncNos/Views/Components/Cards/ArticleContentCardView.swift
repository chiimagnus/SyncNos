import SwiftUI

// MARK: - Article Load State

/// 文章内容加载状态（驱动 ArticleContentCardView 渲染）
enum ArticleLoadState: Equatable {
    /// 未加载（初始状态）
    case notLoaded
    /// 正在加载完整内容
    case loadingFull
    /// 已加载完整内容
    case loaded(content: String, wordCount: Int)
    /// 已加载但无内容
    case empty
    /// 加载失败
    case error(message: String)
    
    var isLoaded: Bool {
        if case .loaded = self { return true }
        return false
    }
    
}

// MARK: - Article Content Card View

/// 展示文章全文的内容卡片（状态驱动）。
/// 
/// 支持以下状态：
/// - `notLoaded`: 初始状态，显示加载指示器
/// - `loadingFull`: 加载完整内容中
/// - `loaded`: 已加载完整内容
/// - `empty`: 无内容
/// - `error`: 加载失败，显示错误信息和重试按钮
struct ArticleContentCardView: View {
    // MARK: - Properties
    
    /// 加载状态
    let loadState: ArticleLoadState

    /// 可选：用于富文本渲染的 HTML（有内容时优先使用）
    let htmlContent: String?

    /// HTML baseURL（用于相对链接/图片）
    let htmlBaseURL: URL?
    
    /// 可选：覆盖宽度（用于 live resize 冻结）
    let overrideWidth: CGFloat?
    
    /// 输出当前测量宽度
    @Binding var measuredWidth: CGFloat
    
    /// 重试回调（仅 error 状态使用）
    let onRetry: (() async -> Void)?

    @State private var htmlContentHeight: CGFloat = 320
    
    // MARK: - Initialization
    
    init(
        loadState: ArticleLoadState,
        htmlContent: String? = nil,
        htmlBaseURL: URL? = nil,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        onRetry: (() async -> Void)? = nil
    ) {
        self.loadState = loadState
        self.htmlContent = htmlContent
        self.htmlBaseURL = htmlBaseURL
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.onRetry = onRetry
    }
    
    // MARK: - Body
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            headerSection
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
                
            case .loadingFull:
                loadingFullContent
                
            case .loaded(let content, _):
                loadedContent(content)
                
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
    
    /// 加载中状态
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
        Group {
            if let htmlContent,
               !htmlContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                HTMLWebView(
                    html: htmlContent,
                    baseURL: htmlBaseURL,
                    openLinksInExternalBrowser: true,
                    contentHeight: $htmlContentHeight
                )
                .frame(height: max(320, htmlContentHeight))
            } else {
                Text(content)
                    .scaledFont(.body)
                    .foregroundColor(.primary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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
        case .loaded(_, let count):
            return count
        default:
            return 0
        }
    }
    
}
