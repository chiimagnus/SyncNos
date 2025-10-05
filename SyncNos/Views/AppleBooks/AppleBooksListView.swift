import SwiftUI
import AppKit

struct AppleBooksListView: View {
    @ObservedObject var viewModel: BookViewModel
    @Binding var selectedBookId: String?

    var body: some View {
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
                            // Sync status icon
                            if viewModel.syncingBookIds.contains(book.bookId) {
                                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                                    .foregroundColor(.yellow)
                                    .help("Syncing")
                            } else if viewModel.syncedBookIds.contains(book.bookId) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .help("Synced")
                            }
                        }
                        .padding(.vertical, 4)
                        .tag(book.bookId)
                        .contextMenu {
                            Button("Not yet realized", systemImage: "heart", action: {})
                        }
                    }
                }
                .listStyle(.sidebar)
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
            BookmarkStore.shared.stopAccessingIfNeeded()
        }
        .onReceive(
            NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
                .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")))
                .receive(on: DispatchQueue.main)
        ) { notification in
            if notification.name == Notification.Name("AppleBooksContainerSelected") {
                guard let selectedPath = notification.object as? String else { return }
                let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                viewModel.setDbRootOverride(rootCandidate)
            }
            viewModel.loadBooks()
        }
        .onChange(of: viewModel.books) { books in
            if selectedBookId == nil {
                selectedBookId = books.first?.bookId
            }
        }
    }
}
