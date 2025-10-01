import SwiftUI
import AppKit

// A simple waterfall (masonry) layout that adapts column count to the available width.
private struct WaterfallLayout: Layout {
    var minColumnWidth: CGFloat = 280
    var spacing: CGFloat = 12
    // When provided, use this width for internal layout computation to "freeze" columns
    var overrideWidth: CGFloat? = nil

    private func computeColumnInfo(width: CGFloat, subviews: Subviews) -> (positions: [CGPoint], totalHeight: CGFloat, columnWidth: CGFloat) {
        // Sanitize inputs to avoid NaN/Inf and negative values
        let safeWidth: CGFloat = (width.isFinite && width > 0) ? width : 1
        let safeSpacing: CGFloat = (spacing.isFinite && spacing >= 0) ? spacing : 0
        let safeMinWidth: CGFloat = (minColumnWidth.isFinite && minColumnWidth > 0) ? minColumnWidth : 1

        let denom = max(safeMinWidth + safeSpacing, 1)
        let rawColumnCount = (safeWidth + safeSpacing) / denom
        let columnCount = max(1, Int(rawColumnCount.isFinite ? rawColumnCount : 1))
        let computedColumnWidth = (safeWidth - CGFloat(columnCount - 1) * safeSpacing) / CGFloat(columnCount)
        let columnWidth = max(1, computedColumnWidth.isFinite ? computedColumnWidth : safeMinWidth)

        var columnHeights = Array(repeating: CGFloat(0), count: columnCount)
        var positions: [CGPoint] = Array(repeating: .zero, count: subviews.count)
        var maxHeight: CGFloat = 0

        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: columnWidth, height: nil))
            // Place into the shortest column
            let targetColumn = columnHeights.enumerated().min(by: { $0.element < $1.element })?.offset ?? 0
            let x = CGFloat(targetColumn) * (columnWidth + spacing)
            let y = columnHeights[targetColumn]
            positions[index] = CGPoint(x: x, y: y)
            columnHeights[targetColumn] = y + size.height + spacing
            maxHeight = max(maxHeight, columnHeights[targetColumn])
        }

        let totalHeight = max(0, maxHeight - spacing)
        return (positions, totalHeight, columnWidth)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let proposedWidth = proposal.width ?? 0
        guard proposedWidth > 0 else { return .zero }
        let usedWidth = overrideWidth ?? proposedWidth
        let info = computeColumnInfo(width: usedWidth, subviews: subviews)
        // Report proposed width to parent to avoid affecting outer layout (e.g., NavigationSplitView)
        return CGSize(width: proposedWidth, height: info.totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let actualWidth = bounds.width
        guard actualWidth > 0 else { return }
        let usedWidth = overrideWidth ?? actualWidth
        let info = computeColumnInfo(width: usedWidth, subviews: subviews)
        for index in subviews.indices {
            let position = info.positions[index]
            let point = CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y)
            subviews[index].place(at: point, proposal: .init(width: info.columnWidth, height: nil))
        }
    }
}

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

struct BookDetailView: View {
    let book: BookListItem
    let annotationDBPath: String?
    @StateObject private var viewModel = BookDetailViewModel()
    @State private var isSyncing = false
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil
    @State private var showingSyncError = false
    @State private var syncErrorMessage = ""
    private var contentSource: ContentSource { ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks }
    
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
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Book header
                VStack(alignment: .leading, spacing: 8) {
                    Text(book.bookTitle)
                        .font(.title)
                        .fontWeight(.bold)
                    
                    Text("by \(book.authorName)")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    
                    Text("\(book.highlightCount) highlights")
                        .font(.subheadline)
                    
                    Link("Open in Apple Books", destination: URL(string: book.ibooksURL)!)
                        .font(.subheadline)
                        .padding(.top, 4)
                }
                .padding()
                .background(Color.gray.opacity(0.1))
                .cornerRadius(8)
                
                // Highlights section (Waterfall / Masonry)
                WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: frozenLayoutWidth) {
                    ForEach(viewModel.highlights, id: \.uuid) { highlight in
                        ZStack(alignment: .topTrailing) {
                            VStack(alignment: .leading, spacing: 8) {                                
                                Text(highlight.text)
                                    .font(.body)
                                    .fixedSize(horizontal: false, vertical: true)
                                
                                if let note = highlight.note, !note.isEmpty {
                                    Text(note)
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        if let dateAdded = highlight.dateAdded {
                                            Text("Created: \(dateAdded, formatter: Self.dateFormatter)")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }

                                        if let modified = highlight.modified {
                                            Text("Modified: \(modified, formatter: Self.dateFormatter)")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    }

                                    Spacer(minLength: 0)
                                }
                            }
                            .padding(12)
                            .background(
                                highlight.style.map { Self.highlightStyleColor(for: $0) } ?? Color.gray.opacity(0.12)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            
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
                            .padding(8)
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
                            viewModel.loadNextPage(dbPath: annotationDBPath, assetId: book.bookId)
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
        .frame(minWidth: 400, idealWidth: 600)
        .onAppear {
            viewModel.resetAndLoadFirstPage(dbPath: annotationDBPath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
        }
        .navigationTitle(contentSource.title)
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
                    Button {
                        Task {
                            viewModel.syncSmart(book: book, dbPath: annotationDBPath)
                        }
                    } label: {
                        Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .help("Sync highlights to Notion")
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
            Task {
                viewModel.syncSmart(book: book, dbPath: annotationDBPath)
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

struct BookDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleBook = BookListItem(bookId: "sample-id",
                                       authorName: "Sample Author",
                                       bookTitle: "Sample Book Title",
                                       ibooksURL: "ibooks://assetid/sample-id",
                                       highlightCount: 123)
        
        NavigationView {
            BookDetailView(book: sampleBook, annotationDBPath: nil)
        }
    }
}
