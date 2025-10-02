import SwiftUI
import AppKit

// Track macOS window live-resize events and expose as a SwiftUI binding.
private struct LiveResizeObserver: NSViewRepresentable {
    @Binding var isResizing: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isResizing: $isResizing)
    }

    func makeNSView(context: Context) -> NSView {
        let view = TrackingView()
        view.onStart = { context.coordinator.setResizing(true) }
        view.onEnd = { context.coordinator.setResizing(false) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class TrackingView: NSView {
        var onStart: (() -> Void)?
        var onEnd: (() -> Void)?

        override func viewWillStartLiveResize() {
            onStart?()
        }

        override func viewDidEndLiveResize() {
            onEnd?()
        }
    }

    final class Coordinator {
        var isResizing: Binding<Bool>
        init(isResizing: Binding<Bool>) { self.isResizing = isResizing }
        func setResizing(_ newValue: Bool) {
            let apply = {
                if self.isResizing.wrappedValue != newValue {
                    self.isResizing.wrappedValue = newValue
                }
            }
            if Thread.isMainThread {
                apply()
            } else {
                DispatchQueue.main.async { apply() }
            }
        }
    }
}

struct AppleBookDetailView: View {
    @ObservedObject var viewModelList: BookViewModel
    @Binding var selectedBookId: String?
    @StateObject private var viewModel = AppleBookDetailViewModel()
    @State private var isSyncing = false
    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""
    
    static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
    
    
    static func highlightStyleColor(for style: Int) -> Color {
        switch style {
        case 0:
            return Color.orange.opacity(0.3) // Underline style
        case 1:
            return Color.green.opacity(0.3)
        case 2:
            return Color.blue.opacity(0.3)
        case 3:
            return Color.yellow.opacity(0.3)
        case 4:
            return Color.pink.opacity(0.3)
        case 5:
            return Color.purple.opacity(0.3)
        default:
            return Color.gray.opacity(0.3)
        }
    }
    
    // Removed gridColumns; WaterfallLayout handles adaptive columns.
    
    private var selectedBook: BookListItem? {
        viewModelList.books.first { $0.bookId == (selectedBookId ?? "") } ?? viewModelList.books.first
    }

    var body: some View {
        Group {
            if let book = selectedBook {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // Book header using unified card
                        InfoHeaderCardView(
                            title: book.bookTitle,
                            subtitle: "by \(book.authorName)"
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
                                        Image(systemName: "book")
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
                                    viewModel.loadNextPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId)
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
            } else {
                Text("Select a book to view details").foregroundColor(.secondary)
            }
        }
        .frame(minWidth: 400, idealWidth: 600)
        .onAppear {
            if let book = selectedBook {
                viewModel.resetAndLoadFirstPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
            }
        }
        .onChange(of: selectedBookId) { _ in
            if let book = selectedBook {
                viewModel.resetAndLoadFirstPage(dbPath: viewModelList.annotationDatabasePath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
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
            ToolbarItem(placement: .primaryAction) {
                if viewModel.isSyncing {
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
        .onReceive(
            NotificationCenter.default.publisher(for: Notification.Name("SyncCurrentBookToNotionRequested"))
                .receive(on: DispatchQueue.main)
        ) { _ in
            if let book = selectedBook {
                Task {
                    viewModel.syncSmart(book: book, dbPath: viewModelList.annotationDatabasePath)
                }
            }
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
    }
}

struct AppleBookDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleBook = BookListItem(bookId: "sample-id",
                                       authorName: "Sample Author",
                                       bookTitle: "Sample Book Title",
                                       ibooksURL: "ibooks://assetid/sample-id",
                                       highlightCount: 123)
        
        // Preview for new initializer
        let listVM = BookViewModel()
        return AppleBookDetailView(viewModelList: listVM, selectedBookId: .constant(sampleBook.bookId))
    }
}
