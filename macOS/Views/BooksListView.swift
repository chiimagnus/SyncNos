import SwiftUI
import AppKit

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil

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
                        Text("Error: \(errorMessage)")
                            .multilineTextAlignment(.center)
                            .padding()
                        Button("Retry") { viewModel.loadBooks() }
                            .buttonStyle(.borderedProminent)
                    }
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        Button("Refresh") { viewModel.loadBooks() }
                            .buttonStyle(.borderedProminent)
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
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: { viewModel.loadBooks() }) { Label("Refresh", systemImage: "arrow.clockwise") }
                        .help("Refresh")
                }
                ToolbarItem(placement: .automatic) {
                    Button(action: { NotificationCenter.default.post(name: Notification.Name("ShowSettings"), object: nil) }) {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .help("Open Settings")
                }
            }
        } detail: {
            // Detail content: show selected book details
            if let sel = selectedBookId, let book = viewModel.books.first(where: { $0.bookId == sel }) {
                BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)
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
    }

    // MARK: - Private Helpers
    private func pickAppleBooksContainer() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "Please choose the Apple Books container directory (com.apple.iBooksX) or its Data/Documents path"

        let home = NSHomeDirectory()
        let defaultContainer = "\(home)/Library/Containers/com.apple.iBooksX"
        panel.directoryURL = URL(fileURLWithPath: defaultContainer, isDirectory: true)

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            // Persist security-scoped bookmark for future launches
            BookmarkStore.shared.save(folderURL: url)
            _ = BookmarkStore.shared.startAccessing(url: url)
            let selectedPath = url.path

            // Normalize selection to the root that contains AEAnnotation/BKLibrary under Data/Documents
            let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)

            DispatchQueue.main.async {
                viewModel.setDbRootOverride(rootCandidate)
                viewModel.loadBooks()
            }
        }
    }
}

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
