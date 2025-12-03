import SwiftUI

struct WeReadDetailView: View {
    @ObservedObject var listViewModel: WeReadViewModel
    @Binding var selectedBookId: String?
    @StateObject private var detailViewModel = WeReadDetailViewModel()
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

    private var selectedBook: WeReadBookListItem? {
        listViewModel.displayBooks.first { $0.bookId == (selectedBookId ?? "") } ?? listViewModel.displayBooks.first
    }

    private func color(for style: Int?) -> Color {
        guard let style else {
            return Color.gray.opacity(0.4)
        }
        return HighlightColorUI.color(for: style, source: .weRead)
    }

    var body: some View {
        Group {
            if let book = selectedBook {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        InfoHeaderCardView(
                            title: book.title,
                            subtitle: book.author.isEmpty ? nil : book.author,
                            timestamps: TimestampInfo(
                                addedAt: book.createdAt,
                                modifiedAt: book.updatedAt,
                                lastSyncAt: listViewModel.lastSync(for: book.bookId)
                            )
                        ) {
                            if let url = URL(string: "https://weread.qq.com/") {
                                Link("Open in WeRead Web", destination: url)
                                    .font(.subheadline)
                            }
                        } content: {
                            HStack(spacing: 6) {
                                Image(systemName: "highlighter")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                // 显示已加载/总数
                                if detailViewModel.totalFilteredCount > 0 {
                                    Text("\(detailViewModel.visibleHighlights.count)/\(detailViewModel.totalFilteredCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("\(book.highlightCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        if detailViewModel.isLoading {
                            ProgressView("Loading...")
                                .padding(.top)
                        } else if detailViewModel.visibleHighlights.isEmpty {
                            Text("No highlights found")
                                .foregroundColor(.secondary)
                                .padding(.top)
                        } else {
                            WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil) {
                                ForEach(detailViewModel.visibleHighlights) { h in
                                    HighlightCardView(
                                        colorMark: color(for: h.colorIndex),
                                        content: h.text,
                                        note: h.note,
                                        reviewContents: h.reviewContents,
                                        createdDate: h.createdAt.map { Self.dateFormatter.string(from: $0) },
                                        modifiedDate: nil  // WeRead 没有 modified time
                                    )
                                    .onAppear {
                                        // 当卡片出现时，检查是否需要加载更多
                                        detailViewModel.loadMoreIfNeeded(currentItem: h)
                                    }
                                }
                            }
                            .padding(.top)
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
                            
                            // 加载更多指示器
                            if detailViewModel.isLoadingMore {
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
                            } else if detailViewModel.canLoadMore {
                                // 手动加载更多按钮（备用）
                                HStack {
                                    Spacer()
                                    Button {
                                        detailViewModel.loadNextPage()
                                    } label: {
                                        Text("Load More (\(detailViewModel.totalFilteredCount - detailViewModel.visibleHighlights.count) remaining)")
                                            .font(.caption)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundColor(.accentColor)
                                    Spacer()
                                }
                                .padding()
                            }
                        }
                        
                        // 后台同步指示器
                        if detailViewModel.isBackgroundSyncing {
                            HStack {
                                Spacer()
                                ProgressView()
                                    .scaleEffect(0.6)
                                Text("Syncing in background...")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("WeRead")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                FiltetSortBar(
                    noteFilter: $detailViewModel.noteFilter,
                    selectedStyles: $detailViewModel.selectedStyles,
                    colorTheme: .weRead,
                    sortField: detailViewModel.sortField,
                    isAscending: detailViewModel.isAscending,
                    availableSortFields: [.created],  // WeRead 只支持按创建时间排序
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
                if externalIsSyncing {
                    // 外部（批量）同步状态
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        if let progress = externalSyncProgress {
                            Text(progress).font(.caption)
                        } else {
                            Text("Syncing...").font(.caption)
                        }
                    }
                    .help("Sync in progress")
                } else if detailViewModel.isSyncing {
                    // 内部同步状态
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        if let progress = detailViewModel.syncProgressText {
                            Text(progress).font(.caption)
                        } else {
                            Text("Syncing...").font(.caption)
                        }
                    }
                    .help("Sync in progress")
                } else if let book = selectedBook {
                    Button {
                        detailViewModel.syncSmart(book: book)
                    } label: {
                        Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .help("Sync highlights to Notion")
                }
            }
        }
        .onAppear {
            if let book = selectedBook {
                Task {
                    await detailViewModel.loadHighlights(for: book.bookId)
                }
                // 如果该书正在批量同步，显示外部同步状态
                if let id = selectedBookId, listViewModel.syncingBookIds.contains(id) {
                    externalIsSyncing = true
                }
            }
        }
        .onChange(of: selectedBookId) { _, _ in
            if let book = selectedBook {
                Task {
                    await detailViewModel.loadHighlights(for: book.bookId)
                }
            }
            // 切换时更新外部同步状态
            if let id = selectedBookId {
                externalIsSyncing = listViewModel.syncingBookIds.contains(id)
                if !externalIsSyncing { externalSyncProgress = nil }
            } else {
                externalIsSyncing = false
                externalSyncProgress = nil
            }
        }
        // 监听批量同步进度更新
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncProgressUpdated")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String else { return }
            if bookId == (selectedBookId ?? "") {
                externalIsSyncing = true
                externalSyncProgress = info["progress"] as? String
            }
        }
        // 监听同步状态变化
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String, let status = info["status"] as? String else { return }
            if bookId == (selectedBookId ?? "") {
                switch status {
                case "started": externalIsSyncing = true
                case "succeeded", "failed", "skipped": externalIsSyncing = false; externalSyncProgress = nil
                default: break
                }
            }
        }
        // 同步错误弹窗
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        // Notion 配置弹窗已移至 MainListView 统一处理
        // 监听同步消息变化（仅显示错误）
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
    }
}
