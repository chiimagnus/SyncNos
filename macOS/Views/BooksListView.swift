import SwiftUI
import AppKit

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var showNotionSheet = false
    
    var body: some View {
        NavigationView {
            VStack {
                if viewModel.isLoading {
                    ProgressView("Loading books...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage = viewModel.errorMessage {
                    VStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                            .font(.largeTitle)
                        Text("Error: \(errorMessage)")
                            .multilineTextAlignment(.center)
                            .padding()
                        Button("Retry") {
                            viewModel.loadBooks()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        Button("Refresh") {
                            viewModel.loadBooks()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(viewModel.books, id: \.bookId) { book in
                        NavigationLink(destination: BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)) {
                            VStack(alignment: .leading) {
                                Text(book.bookTitle)
                                    .font(.headline)
                                Text(book.authorName)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                Text("\(book.highlightCount) highlights")
                                    .font(.caption)
//                                    .foregroundColor(.tertiary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .listStyle(SidebarListStyle())
                    .background(.thinMaterial)
                }
            }
            .navigationTitle("Books")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: {
                        viewModel.loadBooks()
                    }) {
                        Image(systemName: "arrow.clockwise")
                    }
                    .help("Refresh")
                }
                ToolbarItem(placement: .automatic) {
                    Button("Open Apple Books notes") {
                        pickAppleBooksContainer()
                    }
                    .help("Choose Apple Books container directory and load notes")
                }
                ToolbarItem(placement: .automatic) {
                    Button("Notion Integration") {
                        showNotionSheet = true
                    }
                    .help("Configure Notion and run example API calls")
                }
            }
        }
        .sheet(isPresented: $showNotionSheet) {
            NotionIntegrationView()
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
