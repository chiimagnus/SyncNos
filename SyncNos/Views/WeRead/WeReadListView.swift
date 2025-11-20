import SwiftUI

struct WeReadListView: View {
    @ObservedObject var viewModel: WeReadViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Group {
            if viewModel.isLoading || viewModel.isComputingList {
                ProgressView("Loading WeRead books...")
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                        .font(.largeTitle)
                    Text(error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            } else if viewModel.books.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "text.book.closed")
                        .foregroundColor(.secondary)
                        .font(.largeTitle)
                    Text("No WeRead books found")
                        .foregroundColor(.secondary)
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleBooks, id: \.bookId) { book in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(book.title)
                                    .font(.headline)
                                    .lineLimit(2)
                                if !book.author.isEmpty {
                                    Text(book.author)
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                HStack(spacing: 8) {
                                    Text("\(book.highlightCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    if let last = viewModel.lastSync(for: book.bookId) {
                                        Text(DateFormatter.localizedString(from: last, dateStyle: .short, timeStyle: .short))
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                            Spacer()
                            if viewModel.syncingBookIds.contains(book.bookId) {
                                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                                    .foregroundColor(.yellow)
                                    .help("Syncing...")
                            } else if viewModel.syncedBookIds.contains(book.bookId) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .help("Synced")
                            }
                        }
                        .padding(.vertical, 4)
                        .tag(book.bookId)
                        .onAppear {
                            viewModel.loadMoreIfNeeded(currentItem: book)
                        }
                        .contextMenu {
                            Button {
                                viewModel.batchSync(bookIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                            } label: {
                                Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle")
                            }

                            Divider()
                            let last = viewModel.lastSync(for: book.bookId)
                            if let lastDate = last {
                                Text("Last Sync: \(DateFormatter.localizedString(from: lastDate, dateStyle: .short, timeStyle: .short))")
                            } else {
                                Text("Last Sync: Never")
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
                .focusedSceneValue(\.selectionCommands, SelectionCommands(
                    selectAll: {
                        let all = Set(viewModel.displayBooks.map { $0.bookId })
                        if !all.isEmpty { selectionIds = all }
                    },
                    deselectAll: {
                        selectionIds.removeAll()
                    },
                    canSelectAll: {
                        let total = viewModel.displayBooks.count
                        return total > 0 && selectionIds.count < total
                    },
                    canDeselect: {
                        !selectionIds.isEmpty
                    }
                ))
            }
        }
        .onAppear {
            viewModel.triggerRecompute()
            if viewModel.books.isEmpty {
                Task {
                    await viewModel.loadBooks()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncSelectedToNotionRequested")).receive(on: DispatchQueue.main)) { _ in
            viewModel.batchSync(bookIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
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
    }
}
