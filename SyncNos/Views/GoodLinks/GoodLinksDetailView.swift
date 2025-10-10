import SwiftUI
import AppKit

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?
    
    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil
    

    var body: some View {
        SyncAlertWrapper(syncMessage: viewModel.syncMessage, errorMessage: viewModel.errorMessage) {
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
                                    // trailing 区域留空（可后续加分享/打开按钮）
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
                                                    Text(dateString(fromUnix: link.addedAt))
                                                        .font(.caption)
                                                }
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text("Modified")
                                                        .font(.caption2)
                                                        .foregroundColor(.secondary)
                                                    Text(dateString(fromUnix: link.modifiedAt))
                                                        .font(.caption)
                                                }
                                                if link.readAt > 0 {
                                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text("Read")
                                                            .font(.caption2)
                                                            .foregroundColor(.secondary)
                                                        Text(dateString(fromUnix: link.readAt))
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
                            }

                            // 高亮列表
                            let highlights = viewModel.highlightsByLinkId[linkId] ?? []
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 6) {
                                    Image(systemName: "quote.opening")
                                        .font(.headline)
                                        .foregroundColor(.secondary)

                                    Text("Highlights")
                                        .font(.headline)
                                        .foregroundColor(.primary)

                                    if !highlights.isEmpty {
                                        Text("\(highlights.count) item\(highlights.count == 1 ? "" : "s")")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    Spacer()
                                }
                                .padding(.bottom, 4)
                                
                                if !highlights.isEmpty {
                                    WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: frozenLayoutWidth) {
                                        ForEach(highlights, id: \.id) { item in
                                            HighlightCardView(
                                                colorMark: item.color.map { goodLinksColor(for: $0) } ?? Color.gray.opacity(0.5),
                                                content: item.content,
                                                note: item.note,
                                                createdDate: dateString(fromUnix: item.time),
                                                modifiedDate: nil
                                            )
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
                        print("[GoodLinksDetailView] onAppear: linkId=\(linkId)")
                        Task {
                            await viewModel.loadHighlights(for: linkId)
                            await viewModel.loadContent(for: linkId)
                        }
                    }
                    .onChange(of: linkId) { newLinkId in
                        print("[GoodLinksDetailView] linkId changed to: \(newLinkId)")
                        Task {
                            await viewModel.loadHighlights(for: newLinkId)
                            await viewModel.loadContent(for: newLinkId)
                        }
                    }
                    .resizeFreeze(isResizing: $isLiveResizing, measuredWidth: $measuredLayoutWidth, frozenWidth: $frozenLayoutWidth)
                    .navigationTitle("GoodLinks")
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) {
                            if let link = viewModel.links.first(where: { $0.id == linkId }) {
                                SharedSyncToolbar(
                                    isSyncing: viewModel.isSyncing,
                                    progressText: viewModel.syncProgressText,
                                    label: "Sync",
                                    help: "Sync highlights to Notion"
                                ) {
                                    Task { viewModel.syncSmart(link: link) }
                                }
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
        .onReceive(
            NotificationCenter.default.publisher(for: Notification.Name("SyncCurrentBookToNotionRequested")).receive(on: DispatchQueue.main)
        ) { _ in
            if let linkId = selectedLinkId, let link = viewModel.links.first(where: { $0.id == linkId }) {
                Task { viewModel.syncSmart(link: link) }
            }
        }
    }
}
