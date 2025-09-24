import SwiftUI
import AppKit
import Combine

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil
    @AppStorage("backgroundImageEnabled") private var backgroundImageEnabled: Bool = false
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    func toggleSidebar() {
        columnVisibility = columnVisibility == .all ? .detailOnly : .all
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            Group {
                if viewModel.isLoading {
                    ProgressView("Loading books...")
                } else if viewModel.errorMessage != nil {
                    VStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                            .font(.largeTitle)
                        Text("Error: Please allow SyncNos to access Apple Books notes; otherwise they cannot be loaded.")
                            .multilineTextAlignment(.center)
                            .padding()
                        // Button("Retry") { viewModel.loadBooks() }
                        //     .buttonStyle(.borderedProminent)
                        // Button("Please restart SyncNos") {
                        //     restartApp()
                        // }
                        // .buttonStyle(.borderedProminent)
                    }
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        // Button("Refresh") { viewModel.loadBooks() }
                            // .buttonStyle(.borderedProminent)
                        Button("Open Apple Books notes") {
                            AppleBooksPicker.pickAppleBooksContainer()
                        }
                    }
                } else {
                    List(selection: $selectedBookId) {
                        ForEach(viewModel.books, id: \.bookId) { book in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(book.bookTitle).font(.headline)
                                    Text(book.authorName).font(.subheadline).foregroundColor(.secondary)
                                    Text("\(book.highlightCount) highlights").font(.caption)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 4)
                            .tag(book.bookId)
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
            .navigationTitle("Books")
        } detail: {
            // Detail content: show selected book details
            if let sel = selectedBookId, let book = viewModel.books.first(where: { $0.bookId == sel }) {
                BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)
                    .id(book.bookId) // force view refresh when selection changes
            } else {
                Text("Select a book to view details").foregroundColor(.secondary)
            }
        }
        .onAppear {
            if let url = BookmarkStore.shared.restore() {
                let started = BookmarkStore.shared.startAccessing(url: url)
                DIContainer.shared.loggerService.debug("Using restored bookmark on appear, startAccess=\(started)")
                let selectedPath = url.path
                let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                viewModel.setDbRootOverride(rootCandidate)
                viewModel.loadBooks()
            }
        }
        .onDisappear {
            // Release security-scoped bookmark when view disappears
            BookmarkStore.shared.stopAccessingIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))) { notif in
            guard let selectedPath = notif.object as? String else { return }
            let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
            viewModel.setDbRootOverride(rootCandidate)
            viewModel.loadBooks()
        }
        .onChange(of: viewModel.books) { books in
            // 当书籍列表首次加载且尚未选择时，默认选中第一个
            if selectedBookId == nil {
                selectedBookId = books.first?.bookId
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ToggleSidebar"))) { _ in
            toggleSidebar()
        }
        .background {
            if backgroundImageEnabled {
                // 使用彩虹渐变背景
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.red.opacity(0.3),
                        Color.orange.opacity(0.3),
                        Color.yellow.opacity(0.3),
                        Color.green.opacity(0.3),
                        Color.blue.opacity(0.3),
                        Color.purple.opacity(0.3),
                        Color.pink.opacity(0.3)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            } else {
                // 使用默认的背景
                Color.clear
            }
        }
    }
}

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
