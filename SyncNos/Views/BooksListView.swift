import SwiftUI
import AppKit
import Combine

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil
    @AppStorage("backgroundImageEnabled") private var backgroundImageEnabled: Bool = false

    var body: some View {
        NavigationSplitView {
            Group {
                if viewModel.isLoading {
                    ProgressView("Loading books...")
                } else if let errorMessage = viewModel.errorMessage {
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
                print("Using restored bookmark on appear, startAccess=\(started)")
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
        .background {
            if backgroundImageEnabled {
                // 使用彩虹渐变背景
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.red.opacity(0.08),
                        Color.orange.opacity(0.08),
                        Color.yellow.opacity(0.08),
                        Color.green.opacity(0.08),
                        Color.blue.opacity(0.08),
                        Color.purple.opacity(0.08),
                        Color.pink.opacity(0.08)
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
