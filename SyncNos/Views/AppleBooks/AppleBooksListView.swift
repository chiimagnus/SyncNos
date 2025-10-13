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
            } else if viewModel.displayBooks.isEmpty {
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
                    ForEach(viewModel.displayBooks, id: \.bookId) { book in
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
                            Button {
                                // 选中该书并触发详情页的同步请求
                                selectedBookId = book.bookId
                                NotificationCenter.default.post(name: Notification.Name("SyncCurrentBookToNotionRequested"), object: nil)
                            } label: {
                                Label("Sync Now (Last Time: \(SyncTimestampStore.shared.getLastSyncTime(for: book.bookId).map { DateFormatter.localizedString(from: $0, dateStyle: .short, timeStyle: .short) } ?? "Never")", systemImage: "arrow.triangle.2.circlepath")
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            // Sort options submenu
                            Picker("Sort by", selection: $viewModel.sortKey) {
                                ForEach(BookListSortKey.allCases, id: \.self) { key in
                                    Text(key.displayName).tag(key)
                                }
                            }

                            Divider()

                            Toggle("Ascending", isOn: $viewModel.sortAscending)

                            Divider()

                            // Filter options
                            Toggle("Books with titles only", isOn: $viewModel.showWithTitleOnly)
                        } label: {
                            Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                        }
                    }
                }
            }
        }
        .onAppear {
            if let url = BookmarkStore.shared.restore() {
                let started = BookmarkStore.shared.startAccessing(url: url)
                DIContainer.shared.loggerService.debug("Using restored bookmark on appear, startAccess=\(started)")
                let selectedPath = url.path
                let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                viewModel.setDbRootOverride(rootCandidate)
                Task {
                    await viewModel.loadBooks()
                }
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
            Task {
                await viewModel.loadBooks()
            }
        }
        .onChange(of: viewModel.displayBooks) { displayBooks in
            if selectedBookId == nil {
                selectedBookId = displayBooks.first?.bookId
            }
        }
    }
}
