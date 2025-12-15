import SwiftUI
import AppKit

struct DedaoDetailView: View {
    @ObservedObject var listViewModel: DedaoViewModel
    @Binding var selectedBookId: String?
    /// 由外部（MainListView）注入：解析当前 Detail 的 NSScrollView，供键盘滚动使用
    var onScrollViewResolved: (NSScrollView) -> Void
    @StateObject private var detailViewModel = DedaoDetailViewModel()
    @Environment(\.openWindow) private var openWindow
    
    // 使用 debounce 延迟更新布局宽度，避免窗口调整大小时频繁重新计算
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var debouncedLayoutWidth: CGFloat = 0
    @State private var layoutWidthDebounceTask: Task<Void, Never>?
    
    // 外部（批量）同步状态
    @State private var externalIsSyncing: Bool = false
    @State private var externalSyncProgress: String?
    
    // 弹窗状态
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()

    private var selectedBook: DedaoBookListItem? {
        listViewModel.displayBooks.first { $0.bookId == (selectedBookId ?? "") } ?? listViewModel.displayBooks.first
    }

    var body: some View {
        mainContent
    }
    
    // MARK: - Main Content
    
    @ViewBuilder
    private var mainContent: some View {
        Group {
            if let book = selectedBook {
                bookDetailView(book: book)
            } else {
                Text("Select a book")
                    .scaledFont(.body)
                    .foregroundColor(.secondary)
            }
        }
    }
    
    @ViewBuilder
    private func bookDetailView(book: DedaoBookListItem) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Top anchor used for programmatic scrolling when content changes
                Color.clear
                    .frame(height: 0)
                    .id("dedaoDetailTop")
                    .background(
                        EnclosingScrollViewReader { scrollView in
                            onScrollViewResolved(scrollView)
                        }
                    )
                bookHeaderView(book: book)
                highlightsContentView(book: book)
                backgroundSyncIndicator
                loadMoreIndicator
            }
            .padding()
        }
        .navigationTitle("Dedao")
        .toolbar { toolbarContent(book: book) }
        .onAppear { loadHighlightsForBook(book) }
        .onChange(of: selectedBookId) { _, newId in handleBookIdChange(newId: newId) }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncProgressUpdated")).receive(on: DispatchQueue.main)) { handleSyncProgressUpdate($0) }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged")).receive(on: DispatchQueue.main)) { handleSyncStatusChange($0) }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: detailViewModel.syncMessage) { _, newMessage in
            if let msg = newMessage, !msg.isEmpty {
                let successKeywords = ["Sync completed", "Incremental sync completed", "Full sync completed"]
                let isSuccess = successKeywords.contains { msg.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = msg
                    showingSyncError = true
                }
            }
        }
    }
    
    // MARK: - Header View
    
    @ViewBuilder
    private func bookHeaderView(book: DedaoBookListItem) -> some View {
        InfoHeaderCardView(
            title: book.title,
            subtitle: book.author.isEmpty ? nil : book.author,
            timestamps: TimestampInfo(
                addedAt: nil,
                modifiedAt: nil,
                lastSyncAt: listViewModel.lastSync(for: book.bookId)
            )
        ) {
            if let url = URL(string: "https://www.dedao.cn/") {
                Link("Open in Dedao Web", destination: url)
                    .scaledFont(.subheadline)
            }
        } content: {
            highlightCountLabel(book: book)
        }
    }
    
    @ViewBuilder
    private func highlightCountLabel(book: DedaoBookListItem) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "highlighter")
                .scaledFont(.caption)
                .foregroundColor(.secondary)
            if detailViewModel.totalFilteredCount > 0 {
                Text("\(detailViewModel.visibleHighlights.count)/\(detailViewModel.totalFilteredCount) highlights")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text("\(book.highlightCount) highlights")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
    
    // MARK: - Highlights Content
    
    @ViewBuilder
    private func highlightsContentView(book: DedaoBookListItem) -> some View {
        if detailViewModel.isLoading {
            ProgressView("Loading...")
                .scaledFont(.body)
                .padding(.top)
        } else if detailViewModel.visibleHighlights.isEmpty {
            Text("No highlights found")
                .scaledFont(.body)
                .foregroundColor(.secondary)
                .padding(.top)
        } else {
            highlightsWaterfallView
        }
    }
    
    @ViewBuilder
    private var highlightsWaterfallView: some View {
        WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil) {
            ForEach(detailViewModel.visibleHighlights) { h in
                HighlightCardView(
                    colorMark: Color("BrandDedao"),
                    content: h.text,
                    note: h.note,
                    reviewContents: [],
                    createdDate: h.createdAt.map { Self.dateFormatter.string(from: $0) },
                    modifiedDate: h.updatedAt.map { Self.dateFormatter.string(from: $0) }
                )
                .onAppear {
                    detailViewModel.loadMoreIfNeeded(currentItem: h)
                }
            }
        }
        .padding(.top)
        .overlay(layoutWidthMeasurer)
    }
    
    private var layoutWidthMeasurer: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            Color.clear
                .onAppear { updateLayoutWidth(w) }
                .onChange(of: w) { _, newW in updateLayoutWidth(newW) }
        }
    }
    
    // MARK: - Indicators
    
    @ViewBuilder
    private var backgroundSyncIndicator: some View {
        if detailViewModel.isBackgroundSyncing {
            HStack(spacing: 6) {
                ProgressView().scaleEffect(0.6)
                Text("Syncing in background...")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 4)
        }
    }
    
    @ViewBuilder
    private var loadMoreIndicator: some View {
        if detailViewModel.isLoadingMore {
            HStack {
                Spacer()
                ProgressView().scaleEffect(0.8)
                Text("Loading...")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                Spacer()
            }
            .padding()
        } else if detailViewModel.canLoadMore && !detailViewModel.visibleHighlights.isEmpty {
            HStack {
                Spacer()
                Button {
                    detailViewModel.loadNextPage()
                } label: {
                    Text("Load More (\(detailViewModel.totalFilteredCount - detailViewModel.visibleHighlights.count) remaining)")
                        .scaledFont(.caption)
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
                Spacer()
            }
            .padding()
        }
    }
    
    // MARK: - Toolbar
    
    @ToolbarContentBuilder
    private func toolbarContent(book: DedaoBookListItem) -> some ToolbarContent {
        ToolbarItem(placement: .automatic) {
            FiltetSortBar(
                noteFilter: $detailViewModel.noteFilter,
                selectedStyles: $detailViewModel.selectedStyles,
                colorTheme: .dedao,
                sortField: detailViewModel.sortField,
                isAscending: detailViewModel.isAscending,
                availableSortFields: [.created, .modified],
                onSortFieldChanged: { field in
                    detailViewModel.sortField = field
                    Task { await detailViewModel.reloadCurrent() }
                },
                onAscendingChanged: { asc in
                    detailViewModel.isAscending = asc
                    Task { await detailViewModel.reloadCurrent() }
                }
            )
        }

        ToolbarItem(placement: .automatic) {
            Spacer()
        }

        ToolbarItem(placement: .automatic) {
            syncToolbarButton(book: book)
        }
    }
    
    @ViewBuilder
    private func syncToolbarButton(book: DedaoBookListItem) -> some View {
        if externalIsSyncing {
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.8)
                Text(externalSyncProgress ?? "Syncing...")
                    .scaledFont(.caption)
            }
            .help("Sync in progress")
        } else if detailViewModel.isSyncing {
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.8)
                Text(detailViewModel.syncProgressText ?? "Syncing...")
                    .scaledFont(.caption)
            }
            .help("Sync in progress")
        } else {
            Button {
                detailViewModel.syncSmart(book: book)
            } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .help("Sync highlights to Notion")
        }
    }
    
    // MARK: - Helper Methods
    
    private func loadHighlightsForBook(_ book: DedaoBookListItem) {
        Task {
            await detailViewModel.loadHighlights(for: book.bookId)
        }
        if listViewModel.syncingBookIds.contains(book.bookId) {
            externalIsSyncing = true
        }
    }
    
    private func handleBookIdChange(newId: String?) {
        if let id = newId {
            Task {
                await detailViewModel.loadHighlights(for: id)
            }
            externalIsSyncing = listViewModel.syncingBookIds.contains(id)
            if !externalIsSyncing { externalSyncProgress = nil }
        } else {
            externalIsSyncing = false
            externalSyncProgress = nil
        }
    }
    
    private func handleSyncProgressUpdate(_ notification: Notification) {
        guard let userInfo = notification.userInfo as? [String: Any],
              let bookId = userInfo["bookId"] as? String,
              bookId == (selectedBookId ?? "") else { return }
        externalIsSyncing = true
        externalSyncProgress = userInfo["progress"] as? String
    }
    
    private func handleSyncStatusChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo as? [String: Any],
              let bookId = userInfo["bookId"] as? String,
              let status = userInfo["status"] as? String,
              bookId == (selectedBookId ?? "") else { return }
        switch status {
        case "started":
            externalIsSyncing = true
        case "succeeded", "failed", "skipped":
            externalIsSyncing = false
            externalSyncProgress = nil
        default:
            break
        }
    }
    
    private func updateLayoutWidth(_ width: CGFloat) {
        layoutWidthDebounceTask?.cancel()
        measuredLayoutWidth = width
        layoutWidthDebounceTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !Task.isCancelled {
                debouncedLayoutWidth = width
            }
        }
    }
}
