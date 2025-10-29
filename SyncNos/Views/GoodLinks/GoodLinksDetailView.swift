import SwiftUI
import AppKit

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?

    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""
    @State private var externalIsSyncing: Bool = false
    @State private var externalSyncProgress: String? = nil

    private var selectedLink: GoodLinksLinkRow? {
        viewModel.links.first { $0.id == (selectedLinkId ?? "") }
    }

    private var filteredHighlights: [GoodLinksHighlightRow] {
        guard let linkId = selectedLinkId else { return [] }
        return viewModel.getFilteredHighlights(for: linkId)
    }

    var body: some View {
        Group {
            if let linkId = selectedLinkId, !linkId.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            // 文章信息卡片 - 使用统一卡片
                            InfoHeaderCardView(
                                title: link.title?.isEmpty == false ? link.title! : link.url,
                                subtitle: link.author,
                                overrideWidth: frozenLayoutWidth
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

                                    Divider()

                                    // 时间与统计
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(spacing: 16) {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("Added")
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Text(formatDate(link.addedAt))
                                                    .font(.caption)
                                            }
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("Modified")
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Text(formatDate(link.modifiedAt))
                                                    .font(.caption)
                                            }
                                            if link.readAt > 0 {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text("Read")
                                                        .font(.caption2)
                                                        .foregroundColor(.secondary)
                                                    Text(formatDate(link.readAt))
                                                        .font(.caption)
                                                }
                                            }
                                        }
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
                                overrideWidth: frozenLayoutWidth,
                                measuredWidth: $measuredLayoutWidth
                            )
                        } else if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            ArticleContentCardView(
                                wordCount: 0,
                                overrideWidth: frozenLayoutWidth,
                                measuredWidth: $measuredLayoutWidth,
                                revealThreshold: nil,
                                customSlot: AnyView(
                                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                                        Text("未检测到正文内容，请")
                                        if let url = URL(string: link.openInGoodLinksURLString) {
                                            Link("Open in GoodLinks", destination: url)
                                                .foregroundColor(.blue)
                                        }
                                        Text("，然后重新下载此文章。")
                                    }
                                )
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
                                    Text("\(filteredHighlights.count) item\(filteredHighlights.count == 1 ? "" : "s")")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }

                                Spacer()
                            }
                            .padding(.top, 4)

                            if !filteredHighlights.isEmpty {
                                WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: frozenLayoutWidth) {
                                    ForEach(filteredHighlights, id: \.id) { item in
                                        HighlightCardView(
                                            colorMark: item.color.map { highlightColor(for: $0) } ?? Color.gray.opacity(0.5),
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
                                                Image(systemName: "link")
                                                    .imageScale(.medium)
                                                    .foregroundColor(.primary)
                                            }
                                            .buttonStyle(.plain)
                                            .help("Open in GoodLinks")
                                            .accessibilityLabel("Open in GoodLinks")
                                        }
                                    }
                                }
                                .overlay(
                                    GeometryReader { proxy in
                                        let w = proxy.size.width
                                        Color.clear
                                            .onAppear { measuredLayoutWidth = w }
                                            .onChange(of: w) { newValue in
                                                measuredLayoutWidth = newValue
                                            }
                                    }
                                )
                            } else {
                                // 空状态提示
                                Text("No highlights for this link yet")
                                    .font(.body)
                                    .foregroundColor(.secondary)
                                    .padding()
                            }
                        }
                    }
                    // .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .onAppear {
                    Task {
                        await viewModel.loadHighlights(for: linkId)
                        await viewModel.loadContent(for: linkId)
                    }
                    if let id = selectedLinkId, viewModel.syncingLinkIds.contains(id) {
                        externalIsSyncing = true
                    }
                }
                .onChange(of: linkId) { newLinkId in
                    Task {
                        await viewModel.loadHighlights(for: newLinkId)
                        await viewModel.loadContent(for: newLinkId)
                    }
                    if let id = selectedLinkId {
                        externalIsSyncing = viewModel.syncingLinkIds.contains(id)
                        if !externalIsSyncing { externalSyncProgress = nil }
                    } else {
                        externalIsSyncing = false
                        externalSyncProgress = nil
                    }
                }
                .background(LiveResizeObserver(isResizing: $isLiveResizing))
                .onChange(of: isLiveResizing) { resizing in
                    if resizing {
                        frozenLayoutWidth = measuredLayoutWidth
                    } else {
                        frozenLayoutWidth = nil
                    }
                }
                .navigationTitle("GoodLinks")
                .toolbar {
                    // Filter bar in toolbar
                    ToolbarItem(placement: .primaryAction) {
                        FiltetSortBar(
                            noteFilter: $viewModel.highlightNoteFilter,
                            selectedStyles: $viewModel.highlightSelectedStyles,
                            colorTheme: .goodLinks,
                            sortField: viewModel.highlightSortField,
                            isAscending: viewModel.highlightIsAscending,
                            onSortFieldChanged: { field in
                                viewModel.highlightSortField = field
                            },
                            onAscendingChanged: { ascending in
                                viewModel.highlightIsAscending = ascending
                            }
                        )
                    }

                    // Sync button / progress
                    ToolbarItem(placement: .primaryAction) {
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
                }
            }
        }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: viewModel.syncMessage) { newMessage in
            if let message = newMessage {
                let successKeywords = ["同步完成", "增量同步完成", "全量同步完成"]
                let isSuccess = successKeywords.contains { message.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
        }
        .onChange(of: selectedLinkId) { _ in
            externalIsSyncing = false
            externalSyncProgress = nil
        }
        .onChange(of: viewModel.highlightsByLinkId) { _ in
            // Trigger UI update when highlights are loaded
            // The filteredHighlights computed property will automatically refresh
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
        .onChange(of: viewModel.errorMessage) { newError in
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
    
    /// 根据GoodLinks的颜色值返回对应的SwiftUI Color
    /// GoodLinks使用整数表示颜色，具体映射可能需要根据实际情况调整
    private func highlightColor(for colorCode: Int) -> Color {
        switch colorCode {
        case 0: return .yellow
        case 1: return .green
        case 2: return .blue
        case 3: return .red
        case 4: return .purple
        default: return .mint
        }
    }
}
