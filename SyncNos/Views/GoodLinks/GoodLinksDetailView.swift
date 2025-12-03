import SwiftUI
import AppKit

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?
    @Environment(\.openWindow) private var openWindow

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

    /// 使用分页后的高亮（而非全部）
    private var filteredHighlights: [GoodLinksHighlightRow] {
        viewModel.visibleHighlights
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
                        if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            // 文章信息卡片 - 使用统一卡片
                            InfoHeaderCardView(
                                title: link.title?.isEmpty == false ? link.title! : link.url,
                                subtitle: link.author,
                                overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
                                timestamps: TimestampInfo(
                                    addedAt: link.addedAt > 0 ? Date(timeIntervalSince1970: link.addedAt) : nil,
                                    modifiedAt: link.modifiedAt > 0 ? Date(timeIntervalSince1970: link.modifiedAt) : nil,
                                    lastSyncAt: viewModel.lastSync(for: link.id)
                                )
                            ) {
                                if let url = URL(string: link.openInGoodLinksURLString) {
                                    Link("Open in GoodLinks", destination: url)
                                        .font(.subheadline)
                                        .foregroundColor(.blue)
                                }
                            } content: {
                                VStack(alignment: .leading, spacing: 10) {
                                    // 收藏与标签
                                    HStack(spacing: 8) {
                                        if link.starred {
                                            Label("Favorited", systemImage: "star.fill")
                                                .font(.caption)
                                                .foregroundColor(.yellow)
                                        }
                                        let tagsText = link.tagsFormatted
                                        if !tagsText.isEmpty {
                                            Label(tagsText, systemImage: "tag")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                    // URL 与原始URL
                                    HStack(spacing: 6) {
                                        Image(systemName: "link")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                        Text("URL")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                            .fontWeight(.medium)
                                        Text(link.url)
                                            .font(.caption)
                                            .foregroundColor(.blue)
                                            .textSelection(.enabled)
                                            .lineLimit(3)                                        
                                    }

                                    if let originalURL = link.originalURL, !originalURL.isEmpty, originalURL != link.url {
                                        HStack(spacing: 6) {
                                            Image(systemName: "arrow.turn.up.left")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                            Text("Original URL")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                                .fontWeight(.medium)
                                            Text(originalURL)
                                                .font(.caption)
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
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                Text("Summary")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                    .fontWeight(.medium)
                                            }
                                            Text(summary)
                                                .font(.body)
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
                        if let contentRow = viewModel.contentByLinkId[linkId], 
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
                                    .font(.headline)
                                    .foregroundColor(.secondary)

                                Text("Highlights")
                                    .font(.headline)
                                    .foregroundColor(.primary)

                                if !filteredHighlights.isEmpty {
                                    Text("\(filteredHighlights.count) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }

                                Spacer()
                            }
                            .padding(.top, 4)

                            if !filteredHighlights.isEmpty {
                                // 显示已加载/总数
                                if viewModel.totalFilteredHighlightCount > 0 {
                                    HStack {
                                        Text("\(filteredHighlights.count)/\(viewModel.totalFilteredHighlightCount) highlights")
                                            .font(.caption)
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
                                            viewModel.loadMoreHighlightsIfNeeded(currentItem: item)
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
                                if viewModel.isLoadingMoreHighlights {
                                    HStack {
                                        Spacer()
                                        ProgressView()
                                            .scaleEffect(0.8)
                                        Text("Loading...")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                        Spacer()
                                    }
                                    .padding()
                                } else if viewModel.canLoadMoreHighlights {
                                    HStack {
                                        Spacer()
                                        Button {
                                            viewModel.loadNextHighlightPage()
                                        } label: {
                                            Text("Load More (\(viewModel.totalFilteredHighlightCount - filteredHighlights.count) remaining)")
                                                .font(.caption)
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
                                    .font(.body)
                                    .foregroundColor(.secondary)
                                    .padding()
                            }
                        }
                        }
                        // .frame(maxWidth: .infinity, alignment: .leading)
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
                .onAppear {
                    Task {
                        await viewModel.loadHighlights(for: linkId)
                        await viewModel.loadContent(for: linkId)
                        // 初始化分页
                        viewModel.initializeHighlightPagination(for: linkId)
                    }
                    if let id = selectedLinkId, viewModel.syncingLinkIds.contains(id) {
                        externalIsSyncing = true
                    }
                }
                .onChange(of: linkId) { _, newLinkId in
                    Task {
                        await viewModel.loadHighlights(for: newLinkId)
                        await viewModel.loadContent(for: newLinkId)
                        // 初始化分页
                        viewModel.initializeHighlightPagination(for: newLinkId)
                    }
                    if let id = selectedLinkId {
                        externalIsSyncing = viewModel.syncingLinkIds.contains(id)
                        if !externalIsSyncing { externalSyncProgress = nil }
                    } else {
                        externalIsSyncing = false
                        externalSyncProgress = nil
                    }
                }
                .navigationTitle("GoodLinks")
                .toolbar {
                    // 中间区域：Filter 控件
                    ToolbarItem(placement: .automatic) {
                        FiltetSortBar(
                            noteFilter: $viewModel.highlightNoteFilter,
                            selectedStyles: $viewModel.highlightSelectedStyles,
                            colorTheme: .goodLinks,
                            sortField: viewModel.highlightSortField,
                            isAscending: viewModel.highlightIsAscending,
                            onSortFieldChanged: { field in
                                viewModel.highlightSortField = field
                                viewModel.reapplyHighlightFilters()
                            },
                            onAscendingChanged: { ascending in
                                viewModel.highlightIsAscending = ascending
                                viewModel.reapplyHighlightFilters()
                            }
                        )
                    }

                    ToolbarItem(placement: .automatic) {
                        Spacer()
                    }

                    // 后缘：Sync 按钮 / 进度
                    ToolbarItem(placement: .automatic) {
                        if externalIsSyncing {
                            HStack(spacing: 8) {
                                ProgressView().scaleEffect(0.8)
                                if let progress = externalSyncProgress {
                                    Text(progress).font(.caption)
                                } else {
                                    Text("Syncing...").font(.caption)
                                }
                            }
                            .help("Sync in progress")
                        } else if viewModel.isSyncing {
                            HStack(spacing: 8) {
                                ProgressView().scaleEffect(0.8)
                                if let progress = viewModel.syncProgressText {
                                    Text(progress).font(.caption)
                                } else {
                                    Text("Syncing...").font(.caption)
                                }
                            }
                            .help("Sync in progress")
                        } else {
                            if let link = viewModel.links.first(where: { $0.id == linkId }) {
                                Button {
                                    Task {
                                        viewModel.syncSmart(link: link)
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
                Task {
                    await viewModel.loadHighlights(for: linkId)
                    await viewModel.loadContent(for: linkId)
                    // 重新初始化分页
                    viewModel.initializeHighlightPagination(for: linkId)
                }
            }
        }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        // Notion 配置弹窗已移至 MainListView 统一处理
        .onChange(of: viewModel.syncMessage) { _, newMessage in
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
        .onChange(of: viewModel.highlightsByLinkId) { _, _ in
            // 高亮加载完成后，重新初始化分页
            if let linkId = selectedLinkId, !linkId.isEmpty {
                viewModel.initializeHighlightPagination(for: linkId)
            }
        }
        .onChange(of: viewModel.highlightNoteFilter) { _, _ in
            viewModel.reapplyHighlightFilters()
        }
        .onChange(of: viewModel.highlightSelectedStyles) { _, _ in
            viewModel.reapplyHighlightFilters()
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
        .onChange(of: viewModel.errorMessage) { _, newError in
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
