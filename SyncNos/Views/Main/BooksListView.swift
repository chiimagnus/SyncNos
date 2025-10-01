import SwiftUI
import AppKit
import Combine

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil
    @AppStorage("backgroundImageEnabled") private var backgroundImageEnabled: Bool = false
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue

    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    var body: some View {
        NavigationSplitView {
            Group {
                if contentSource == .goodLinks {
                    VStack(spacing: 12) {
                        Image(systemName: "link")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text("GoodLinks 视图占位")
                            .font(.headline)
                        Text("即将支持从 GoodLinks 读取列表与高亮")
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.isLoading {
                    ProgressView("Loading books...")
                } else if viewModel.errorMessage != nil {
                    VStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                            .font(.largeTitle)
                        Text("Error: Please allow SyncNos to access Apple Books notes; otherwise they cannot be loaded.")
                            .multilineTextAlignment(.center)
                            .padding()
                    }
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        Button("Open Apple Books notes", systemImage: "book") {
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
                            .contextMenu {
                                Button("Not yet realized", systemImage: "heart", action: {
                                    // 占位符操作
                                })
                            }
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
            .navigationTitle(contentSource.title)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            contentSourceRawValue = ContentSource.appleBooks.rawValue
                        } label: {
                            HStack {
                                Text("Apple Books")
                                if contentSource == .appleBooks { Image(systemName: "checkmark") }
                            }
                        }

                        Button {
                            contentSourceRawValue = ContentSource.goodLinks.rawValue
                        } label: {
                            HStack {
                                Text("GoodLinks")
                                if contentSource == .goodLinks { Image(systemName: "checkmark") }
                            }
                        }
                    } label: {
                        Label(contentSource.title, systemImage: contentSource == .appleBooks ? "book" : "bookmark")
                    }
                }
            }
        } detail: {
            if contentSource == .goodLinks {
                VStack(spacing: 8) {
                    Image(systemName: "text.quote")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("GoodLinks 详情占位")
                        .font(.headline)
                    Text("选择条目后将在此显示高亮内容")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle(contentSource.title)
            } else {
                // Detail content: show selected book details
                if let sel = selectedBookId, let book = viewModel.books.first(where: { $0.bookId == sel }) {
                    BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)
                        .id(book.bookId) // force view refresh when selection changes
                } else {
                    Text("Select a book to view details").foregroundColor(.secondary)
                        .navigationTitle(contentSource.title)
                }
            }
        }
        .onAppear {
            if contentSource == .appleBooks {
                if let url = BookmarkStore.shared.restore() {
                    let started = BookmarkStore.shared.startAccessing(url: url)
                    DIContainer.shared.loggerService.debug("Using restored bookmark on appear, startAccess=\(started)")
                    let selectedPath = url.path
                    let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                    viewModel.setDbRootOverride(rootCandidate)
                    viewModel.loadBooks()
                }
            }
        }
        .onDisappear {
            // Release security-scoped bookmark when view disappears
            BookmarkStore.shared.stopAccessingIfNeeded()
        }
        .onReceive(
            NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
                .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")))
                .receive(on: DispatchQueue.main)
        ) { notification in
            guard contentSource == .appleBooks else { return }
            if notification.name == Notification.Name("AppleBooksContainerSelected") {
                guard let selectedPath = notification.object as? String else { return }
                let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                viewModel.setDbRootOverride(rootCandidate)
            }
            // 无论是选择容器还是手动刷新，都重新加载书籍
            viewModel.loadBooks()
        }
        .onChange(of: viewModel.books) { books in
            // 当书籍列表首次加载且尚未选择时，默认选中第一个
            if selectedBookId == nil {
                selectedBookId = books.first?.bookId
            }
        }
        .onChange(of: contentSourceRawValue) { _ in
            // 切换数据源时重置选择，避免 Apple Books 的选中影响 GoodLinks
            selectedBookId = nil
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
