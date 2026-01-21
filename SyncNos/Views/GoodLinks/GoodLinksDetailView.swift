import SwiftUI

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?
    /// 由外部（MainListView）注入：解析当前 Detail 的 NSScrollView，供键盘滚动使用
    var onScrollViewResolved: (NSScrollView) -> Void
    @Environment(\.openWindow) private var openWindow
    
    // Detail ViewModel - 管理高亮数据
    @StateObject private var detailViewModel = GoodLinksDetailViewModel()

    // 使用 debounce 延迟更新布局宽度，避免窗口调整大小时频繁重新计算
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var debouncedLayoutWidth: CGFloat = 0
    @State private var layoutWidthDebounceTask: Task<Void, Never>?
    @State private var articleIsExpanded: Bool = false
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""
    @State private var externalIsSyncing: Bool = false
    @State private var externalSyncProgress: String? = nil

    private var selectedLink: GoodLinksLinkRow? {
        viewModel.links.first { $0.id == (selectedLinkId ?? "") }
    }

    /// 使用分页后的高亮
    private var filteredHighlights: [GoodLinksHighlightRow] {
        detailViewModel.visibleHighlights
    }

    var body: some View {
        Group {
            if let linkId = selectedLinkId, !linkId.isEmpty {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            // Top anchor used for programmatic scrolling when content changes
                            Color.clear
                                .frame(height: 0)
                                .id("goodlinksDetailTop")
                                .background(
                                    EnclosingScrollViewReader { scrollView in
                                        onScrollViewResolved(scrollView)
                                    }
                                )
                        if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            // 文章信息卡片 - 使用统一卡片
                            InfoHeaderCardView(
                                title: link.title?.isEmpty == false ? link.title! : link.url,
                                subtitle: link.author,
                                overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
                                timestamps: TimestampInfo(
                                    addedAt: link.addedAt > 0 ? Date(timeIntervalSince1970: link.addedAt) : nil,
                                    modifiedAt: link.modifiedAt > 0 ? Date(timeIntervalSince1970: link.modifiedAt) : nil,
                                    lastSyncAt: detailViewModel.lastSync(for: link.id)
                                )
                            ) {
                                if let url = URL(string: link.openInGoodLinksURLString) {
                                    Link("Open in GoodLinks", destination: url)
                                        .scaledFont(.subheadline)
                                        .foregroundColor(.blue)
                                }
                            } content: {
                                VStack(alignment: .leading, spacing: 10) {
                                    // 收藏与标签
                                    HStack(spacing: 8) {
                                        if link.starred {
                                            Label("Favorited", systemImage: "star.fill")
                                                .scaledFont(.caption)
                                                .foregroundColor(.yellow)
                                        }
                                        let tagsText = link.tagsFormatted
                                        if !tagsText.isEmpty {
                                            Label(tagsText, systemImage: "tag")
                                                .scaledFont(.caption)
                                                .foregroundColor(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                    // URL 与原始URL
                                    HStack(spacing: 6) {
                                        Image(systemName: "link")
                                            .scaledFont(.caption)
                                            .foregroundColor(.secondary)
                                        Text("URL")
                                            .scaledFont(.caption, weight: .medium)
                                            .foregroundColor(.secondary)
                                        Text(link.url)
                                            .scaledFont(.caption)
                                            .foregroundColor(.blue)
                                            .textSelection(.enabled)
                                            .lineLimit(3)                                        
                                    }

                                    if let originalURL = link.originalURL, !originalURL.isEmpty, originalURL != link.url {
                                        HStack(spacing: 6) {
                                            Image(systemName: "arrow.turn.up.left")
                                                .scaledFont(.caption)
                                                .foregroundColor(.secondary)
                                            Text("Original URL")
                                                .scaledFont(.caption, weight: .medium)
                                                .foregroundColor(.secondary)
                                            Text(originalURL)
                                                .scaledFont(.caption)
                                                .foregroundColor(.blue)
                                                .textSelection(.enabled)
                                                .lineLimit(2)
                                        }
                                    }

                                    // 摘要
                                    if let summary = link.summary, !summary.isEmpty {
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack(spacing: 6) {
                                                Image(systemName: "doc.text")
                                                    .scaledFont(.caption)
                                                    .foregroundColor(.secondary)
                                                Text("Summary")
                                                    .scaledFont(.caption, weight: .medium)
                                                    .foregroundColor(.secondary)
                                            }
                                            Text(summary)
                                                .scaledFont(.body)
                                                .foregroundColor(.primary)
                                                .textSelection(.enabled)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        .padding(.top, 4)
                                    }
                                }
                            }
                        }
                        
                        // 全文内容 - 根据加载状态显示不同 UI
                        articleContentSection(linkId: linkId)

                        // 高亮列表
                        VStack(alignment: .leading, spacing: 8) {

                            HStack(spacing: 6) {
                                Image(systemName: "quote.opening")
                                    .scaledFont(.headline)
                                    .foregroundColor(.secondary)

                                Text("Highlights")
                                    .scaledFont(.headline)
                                    .foregroundColor(.primary)

                                if !filteredHighlights.isEmpty {
                                    Text("\(filteredHighlights.count) highlights")
                                        .scaledFont(.caption)
                                        .foregroundColor(.secondary)
                                }

                                Spacer()
                            }
                            .padding(.top, 4)

                            if !filteredHighlights.isEmpty {
                                // 显示已加载/总数
                                if detailViewModel.totalFilteredCount > 0 {
                                    HStack {
                                        Text("\(filteredHighlights.count)/\(detailViewModel.totalFilteredCount) highlights")
                                            .scaledFont(.caption)
                                            .foregroundColor(.secondary)
                                        Spacer()
                                    }
                                }
                                
                                WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil) {
                                    ForEach(filteredHighlights, id: \.id) { item in
                                        HighlightCardView(
                                            colorMark: item.color.map { HighlightColorUI.color(for: $0, source: .goodLinks) } ?? Color.gray.opacity(0.5),
                                            content: item.content,
                                            note: item.note,
                                            createdDate: formatDate(item.time),
                                            modifiedDate: nil
                                        ) {
                                            Button {
                                                if let url = URL(string: item.openInGoodLinksHighlightURLString) {
                                                    NSWorkspace.shared.open(url)
                                                }
                                            } label: {
                                                Image(systemName: "location")
                                                    .imageScale(.medium)
                                                    .foregroundColor(.primary)
                                            }
                                            .buttonStyle(.plain)
                                            .help("Open in GoodLinks")
                                            .accessibilityLabel("Open in GoodLinks")
                                        }
                                        .onAppear {
                                            // 滚动加载更多
                                            detailViewModel.loadMoreIfNeeded(currentItem: item)
                                        }
                                    }
                                }
                                .overlay(
                                    GeometryReader { proxy in
                                        let w = proxy.size.width
                                        Color.clear
                                            .onAppear {
                                                measuredLayoutWidth = w
                                                debouncedLayoutWidth = w
                                            }
                                            .onChange(of: w) { _, newValue in
                                                measuredLayoutWidth = newValue
                                                // 取消之前的 debounce 任务
                                                layoutWidthDebounceTask?.cancel()
                                                // 创建新的 debounce 任务，延迟 0.3 秒更新
                                                layoutWidthDebounceTask = Task { @MainActor in
                                                    try? await Task.sleep(nanoseconds: 300_000_000) // 0.3 秒
                                                    if !Task.isCancelled {
                                                        debouncedLayoutWidth = newValue
                                                    }
                                                }
                                            }
                                    }
                                )
                                
                                // 加载更多 UI
                                if detailViewModel.isLoadingMore {
                                    HStack {
                                        Spacer()
                                        ProgressView()
                                            .scaleEffect(0.8)
                                        Text("Loading...")
                                            .scaledFont(.caption)
                                            .foregroundColor(.secondary)
                                        Spacer()
                                    }
                                    .padding()
                                } else if detailViewModel.canLoadMore {
                                    HStack {
                                        Spacer()
                                        Button {
                                            detailViewModel.loadNextPage()
                                        } label: {
                                            Text("Load More (\(detailViewModel.totalFilteredCount - filteredHighlights.count) remaining)")
                                                .scaledFont(.caption)
                                        }
                                        .buttonStyle(.plain)
                                        .foregroundColor(.accentColor)
                                        Spacer()
                                    }
                                    .padding()
                                }
                            } else {
                                // 空状态提示
                                Text("No highlights found")
                                    .scaledFont(.body)
                                    .foregroundColor(.secondary)
                                    .padding()
                            }
                        }
                        }
                        .padding()
                    }
                    // 监听展开/折叠状态变化，按需加载/卸载全文内容
                    .onChange(of: articleIsExpanded) { _, expanded in
                        if expanded {
                            // 展开时按需加载全文
                            Task {
                                await detailViewModel.loadContentOnDemand()
                            }
                        } else {
                            // 折叠时卸载全文，释放内存
                            detailViewModel.unloadContent()
                            withAnimation {
                                proxy.scrollTo("goodlinksDetailTop", anchor: .top)
                            }
                        }
                    }
                    // Scroll to top when selected link changes
                    .onChange(of: linkId) { _, _ in
                        withAnimation {
                            proxy.scrollTo("goodlinksDetailTop", anchor: .top)
                        }
                    }
                }
                // 将加载绑定到 SwiftUI 生命周期：当 linkId 变化或 Detail 消失时自动取消旧任务
                // 加载高亮和内容预览（完整内容在用户展开时按需加载）
                .task(id: linkId) {
                    detailViewModel.clear()
                    await detailViewModel.loadHighlights(for: linkId)
                    await detailViewModel.loadContentPreview(for: linkId)
                    externalIsSyncing = viewModel.syncingLinkIds.contains(linkId)
                    if !externalIsSyncing { externalSyncProgress = nil }
                }
                .navigationTitle("GoodLinks")
                .toolbar {
                    // Filter 控件
                    ToolbarItem(placement: .automatic) {
                        FilterSortBar(
                            noteFilter: $detailViewModel.noteFilter,
                            selectedStyles: $detailViewModel.selectedStyles,
                            colorTheme: .goodLinks,
                            sortField: detailViewModel.sortField,
                            isAscending: detailViewModel.isAscending,
                            onSortFieldChanged: { field in
                                detailViewModel.sortField = field
                                detailViewModel.reapplyFilters()
                            },
                            onAscendingChanged: { ascending in
                                detailViewModel.isAscending = ascending
                                detailViewModel.reapplyFilters()
                            }
                        )
                    }

                    ToolbarItem(placement: .automatic) {
                        Spacer()
                    }

                    // Sync 按钮 / 进度
                    ToolbarItem(placement: .automatic) {
                        if externalIsSyncing {
                            HStack(spacing: 8) {
                                ProgressView().scaleEffect(0.8)
                                if let progress = externalSyncProgress {
                                    Text(progress).scaledFont(.caption)
                                } else {
                                    Text("Syncing...").scaledFont(.caption)
                                }
                            }
                            .help("Sync in progress")
                        } else {
                            if let link = viewModel.links.first(where: { $0.id == linkId }) {
                                Button {
                                    // 同步入口统一放在 ListVM，避免 DetailVM 被同步任务强持有导致内存无法释放
                                    viewModel.batchSync(linkIds: Set([link.id]))
                                } label: {
                                    Label("Sync", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                                }
                                .help("Sync highlights to Notion")
                            }
                        }
                    }
                }
            }
        }
        .frame(minWidth: 400, idealWidth: 600)
        .onDisappear {
            layoutWidthDebounceTask?.cancel()
            layoutWidthDebounceTask = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: .refreshBooksRequested).receive(on: DispatchQueue.main)) { _ in
            if let linkId = selectedLinkId, !linkId.isEmpty {
                // 保存当前展开状态
                let wasExpanded = articleIsExpanded
                detailViewModel.clear()
                Task {
                    await detailViewModel.loadHighlights(for: linkId)
                    await detailViewModel.loadContentPreview(for: linkId)
                    // 如果刷新前是展开状态，重新加载完整内容
                    if wasExpanded {
                        await detailViewModel.loadContentOnDemand()
                    }
                }
            }
        }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: selectedLinkId) { _, _ in
            articleIsExpanded = false
            detailViewModel.unloadContent()  // 切换时卸载全文，释放内存
            externalIsSyncing = false
            externalSyncProgress = nil
        }
        .onChange(of: detailViewModel.highlights) { _, _ in
            // 高亮加载完成后，重新应用筛选
            detailViewModel.reapplyFilters()
        }
        .onChange(of: detailViewModel.noteFilter) { _, _ in
            detailViewModel.reapplyFilters()
        }
        .onChange(of: detailViewModel.selectedStyles) { _, _ in
            detailViewModel.reapplyFilters()
        }
        .onReceive(NotificationCenter.default.publisher(for: .syncProgressUpdated).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String else { return }
            if bookId == (selectedLinkId ?? "") {
                externalIsSyncing = true
                externalSyncProgress = info["progress"] as? String
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .syncBookStatusChanged).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String, let status = info["status"] as? String else { return }
            if bookId == (selectedLinkId ?? "") {
                switch status {
                case "started":
                    externalIsSyncing = true
                case "succeeded", "skipped":
                    externalIsSyncing = false
                    externalSyncProgress = nil
                case "failed":
                    externalIsSyncing = false
                    externalSyncProgress = nil
                    if let errorInfo = info["errorInfo"] as? SyncErrorInfo {
                        syncErrorMessage = errorInfo.details ?? errorInfo.message
                        showingSyncError = true
                    }
                default: break
                }
            }
        }
        .onChange(of: detailViewModel.errorMessage) { _, newError in
            if let err = newError, !err.isEmpty {
                syncErrorMessage = err
                showingSyncError = true
            }
        }
    }
    
    // MARK: - Helper Functions
    
    /// 格式化时间戳为可读日期
    private func formatDate(_ timestamp: Double) -> String {
        guard timestamp > 0 else { return "Unknown" }
        let date = Date(timeIntervalSince1970: timestamp)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.string(from: date)
    }
    
    // MARK: - Article Content Section (按需加载)
    
    /// 将 ViewModel 的 ContentLoadState 映射为 ArticleLoadState
    private func mapToArticleLoadState(linkId: String) -> ArticleLoadState {
        switch detailViewModel.contentLoadState {
        case .notLoaded:
            return .notLoaded
            
        case .preview(let content, let wordCount):
            return .preview(content: content, wordCount: wordCount)
            
        case .loadingFull:
            return .loadingFull
            
        case .loaded:
            if let contentRow = detailViewModel.content,
               let fullText = contentRow.content,
               !fullText.isEmpty {
                return .loaded(content: fullText, wordCount: contentRow.wordCount)
            } else {
                // 已加载但无内容
                let link = viewModel.links.first(where: { $0.id == linkId })
                let openURL = link.flatMap { URL(string: $0.openInGoodLinksURLString) }
                return .empty(openURL: openURL)
            }
            
        case .error(let message):
            return .error(message: message)
        }
    }
    
    /// 渲染全文内容卡片
    @ViewBuilder
    private func articleContentSection(linkId: String) -> some View {
        ArticleContentCardView(
            loadState: mapToArticleLoadState(linkId: linkId),
            isExpanded: $articleIsExpanded,
            overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
            measuredWidth: $measuredLayoutWidth,
            onRetry: { [weak detailViewModel] in
                await detailViewModel?.loadContentOnDemand()
            }
        )
    }
}
