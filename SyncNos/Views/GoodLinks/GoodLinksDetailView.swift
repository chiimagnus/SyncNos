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
                        
                        // 全文内容
                        if let contentRow = detailViewModel.content, 
                           let fullText = contentRow.content, 
                           !fullText.isEmpty {
                            ArticleContentCardView(
                                wordCount: contentRow.wordCount,
                                contentText: fullText,
                                overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
                                measuredWidth: $measuredLayoutWidth,
                                isExpanded: $articleIsExpanded
                            )
                        } else if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            ArticleContentCardView(
                                wordCount: 0,
                                overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
                                measuredWidth: $measuredLayoutWidth,
                                revealThreshold: nil,
                                customSlot: AnyView(
                                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                                        Text("No article content detected. Please")
                                        if let url = URL(string: link.openInGoodLinksURLString) {
                                            Link("Open in GoodLinks", destination: url)
                                                .foregroundColor(.blue)
                                        }
                                        Text("and re-download this article.")
                                    }
                                ),
                                isExpanded: $articleIsExpanded
                            )
                        }

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
                    // when the article collapses, ensure we scroll to top to avoid empty space
                    .onChange(of: articleIsExpanded) { _, expanded in
                        if !expanded {
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
                .task(id: linkId) {
                    // 清空并重新加载（task 会在 linkId 变化/视图消失时自动取消）
                    detailViewModel.clear()
                    await detailViewModel.loadHighlights(for: linkId)
                    await detailViewModel.loadContent(for: linkId)
                    
                    // 切换到某个 item 时，依据 ViewModel 中的 syncing 集合立即更新外部同步显示
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
                        } else if detailViewModel.isSyncing {
                            HStack(spacing: 8) {
                                ProgressView().scaleEffect(0.8)
                                if let progress = detailViewModel.syncProgressText {
                                    Text(progress).scaledFont(.caption)
                                } else {
                                    Text("Syncing...").scaledFont(.caption)
                                }
                            }
                            .help("Sync in progress")
                        } else {
                            if let link = viewModel.links.first(where: { $0.id == linkId }) {
                                Button {
                                    Task {
                                        detailViewModel.syncSmart(link: link)
                                    }
                                } label: {
                                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                                }
                                .help("Sync highlights to Notion")
                            }
                        }
                    }
                }
            }
        }
        .frame(minWidth: 400, idealWidth: 600)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
            if let linkId = selectedLinkId, !linkId.isEmpty {
                detailViewModel.clear()
                Task {
                    await detailViewModel.loadHighlights(for: linkId)
                    await detailViewModel.loadContent(for: linkId)
                }
            }
        }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: detailViewModel.syncMessage) { _, newMessage in
            if let message = newMessage {
                let successKeywords = ["Sync completed", "Incremental sync completed", "Full sync completed"]
                let isSuccess = successKeywords.contains { message.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
        }
        .onChange(of: selectedLinkId) { _, _ in
            articleIsExpanded = false
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncProgressUpdated")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String else { return }
            if bookId == (selectedLinkId ?? "") {
                externalIsSyncing = true
                externalSyncProgress = info["progress"] as? String
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String, let status = info["status"] as? String else { return }
            if bookId == (selectedLinkId ?? "") {
                switch status {
                case "started": externalIsSyncing = true
                case "succeeded", "failed", "skipped": externalIsSyncing = false; externalSyncProgress = nil
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
}
