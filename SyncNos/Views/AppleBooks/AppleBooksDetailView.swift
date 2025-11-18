import SwiftUI
import AppKit

struct AppleBooksDetailView: View {
    @ObservedObject var viewModelList: AppleBooksViewModel
    @Binding var selectedBookId: String?
    @StateObject private var viewModel = AppleBooksDetailViewModel()
    @State private var isSyncing = false
    @Environment(\.openWindow) private var openWindow
    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""
    // External (batch) sync state for the currently selected book
    @State private var externalIsSyncing: Bool = false
    @State private var externalSyncProgress: String? = nil
    
    static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
    
    
    static func highlightStyleColor(for style: Int) -> Color {
        HighlightColorUI.color(for: style, source: .appleBooks)
    }
        
    private var selectedBook: BookListItem? {
        viewModelList.displayBooks.first { $0.bookId == (selectedBookId ?? "") } ?? viewModelList.displayBooks.first
    }

    var body: some View {
        Group {
            if let book = selectedBook {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            // Top anchor used for programmatic scrolling when content changes
                            Color.clear
                                .frame(height: 0)
                                .id("appleBooksDetailTop")
                            // Book header using unified card
                            InfoHeaderCardView(
                                title: book.hasTitle ? book.bookTitle : "No Title",
                                subtitle: book.hasTitle ? book.authorName : "\(book.authorName) • \(String(localized: "Book file not found on device or iCloud"))",
                                overrideWidth: frozenLayoutWidth
                            ) {
                                if !book.ibooksURL.isEmpty, let ibooksURL = URL(string: book.ibooksURL) {
                                    Link("Open in Apple Books", destination: ibooksURL)
                                        .font(.subheadline)
                                }
                            } content: {
                                HStack(spacing: 12) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "highlighter")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                        Text("\(book.highlightCount) highlights")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                            // Highlights section (Waterfall / Masonry)
                            WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: frozenLayoutWidth) {
                                ForEach(viewModel.highlights, id: \.uuid) { highlight in
                                    HighlightCardView(
                                        colorMark: highlight.style.map { Self.highlightStyleColor(for: $0) } ?? Color.gray.opacity(0.5),
                                        content: highlight.text,
                                        note: highlight.note,
                                        createdDate: highlight.dateAdded.map { Self.dateFormatter.string(from: $0) },
                                        modifiedDate: highlight.modified.map { Self.dateFormatter.string(from: $0) }
                                    ) {
                                        Button {
                                            if let location = highlight.location {
                                                let url = URL(string: "ibooks://assetid/\(book.bookId)#\(location)")!
                                                NSWorkspace.shared.open(url)
                                            } else {
                                                let url = URL(string: "ibooks://assetid/\(book.bookId)")!
                                                NSWorkspace.shared.open(url)
                                            }
                                        } label: {
                                            Image(systemName: "location")
                                                .imageScale(.medium)
                                                .foregroundColor(.primary)
                                        }
                                        .buttonStyle(.plain)
                                        .help("Open in Apple Books")
                                        .accessibilityLabel("Open in Apple Books")
                                    }
                                }
                            }
                            .padding(.top)
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

                            if viewModel.canLoadMore {
                                HStack {
                                    Spacer()
                                    Button(action: {
                                        Task {
                                            await viewModel.loadNextPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId)
                                        }
                                    }) {
                                        if viewModel.isLoadingPage {
                                            ProgressView()
                                        } else {
                                            Text("Load more")
                                        }
                                    }
                                    // .buttonStyle(.borderedProminent)
                                    Spacer()
                                }
                                .padding(.top, 8)
                            }
                        }
                        .padding()
                    }
                    // Scroll to top when selected book changes
                    .onChange(of: selectedBookId) { _ in
                        withAnimation {
                            proxy.scrollTo("appleBooksDetailTop", anchor: .top)
                        }
                    }
                }
            } else {
                Text("Select a book to view details").foregroundColor(.secondary)
            }
        }
        .frame(minWidth: 400, idealWidth: 600)
        .onAppear {
            if let book = selectedBook {
                Task {
                    await viewModel.resetAndLoadFirstPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
                }
                // 若返回时该 book 正在批量同步，立即显示外部同步状态
                if let id = selectedBookId, viewModelList.syncingBookIds.contains(id) {
                    externalIsSyncing = true
                }
            }
        }
        .onChange(of: selectedBookId) { _ in
            if let book = selectedBook {
                Task {
                    await viewModel.resetAndLoadFirstPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
                }
            }
            // 切换到某个 item 时，依据 ViewModel 中的 syncing 集合立即更新外部同步显示
            if let id = selectedBookId {
                externalIsSyncing = viewModelList.syncingBookIds.contains(id)
                if !externalIsSyncing { externalSyncProgress = nil }
            } else {
                externalIsSyncing = false
                externalSyncProgress = nil
            }
        }
        .navigationTitle("Apple Books")
        .background(LiveResizeObserver(isResizing: $isLiveResizing))
        .onChange(of: isLiveResizing) { resizing in
            if resizing {
                frozenLayoutWidth = measuredLayoutWidth
            } else {
                frozenLayoutWidth = nil
            }
        }
        .toolbar {
            // 中间区域：Filter 控件
            ToolbarItem(placement: .automatic) {
                FiltetSortBar(
                    noteFilter: $viewModel.noteFilter,
                    selectedStyles: $viewModel.selectedStyles,
                    colorTheme: .appleBooks,
                    sortField: viewModel.sortField,
                    isAscending: viewModel.isAscending,
                    onSortFieldChanged: { field in viewModel.sortField = field },
                    onAscendingChanged: { asc in viewModel.isAscending = asc }
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
                    if let book = selectedBook {
                        Button {
                            Task {
                                viewModel.syncSmart(book: book, dbPath: viewModelList.annotationDatabasePath)
                            }
                        } label: {
                            Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .help("Sync highlights to Notion")
                    }
                }
            }
        }
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .alert("Notion Configuration Required", isPresented: $viewModel.showNotionConfigAlert) {
            Button("Go to Settings") {
                openWindow(id: "setting")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    NotificationCenter.default.post(name: Notification.Name("NavigateToNotionSettings"), object: nil)
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Please configure Notion API Key and Page ID before syncing.")
        }
        .onChange(of: viewModel.syncMessage) { newMessage in
            if let message = newMessage {
                // 仅在消息明显是错误时弹窗；“同步完成”等成功文案不提示
                let successKeywords = ["同步完成", "增量同步完成", "全量同步完成"]
                let isSuccess = successKeywords.contains { message.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
        }
        .onChange(of: selectedBookId) { _ in
            // 切换选中项时清理外部同步显示，避免遗留状态影响新选中项
            externalIsSyncing = false
            externalSyncProgress = nil
        }
        // 监听来自批量同步的进度更新（仅当该进度对应当前选中的 book 时显示）
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncProgressUpdated")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let bookId = info["bookId"] as? String else { return }
            if bookId == (selectedBookId ?? "") {
                externalIsSyncing = true
                externalSyncProgress = info["progress"] as? String
            }
        }
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
    }
}

struct AppleBooksDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleBook = BookListItem(bookId: "sample-id",
                                       authorName: "Sample Author",
                                       bookTitle: "Sample Book Title",
                                       ibooksURL: "ibooks://assetid/sample-id",
                                       highlightCount: 123)
        
        // Preview for new initializer
        let listVM = AppleBooksViewModel()
        return AppleBooksDetailView(viewModelList: listVM, selectedBookId: .constant(sampleBook.bookId))
    }
}
