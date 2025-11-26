import SwiftUI
import AppKit

struct AppleBooksListView: View {
    @ObservedObject var viewModel: AppleBooksViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool

    var body: some View {
        Group {
            if viewModel.isLoading || viewModel.isComputingList {
                ProgressView("Loading...")
            } else if viewModel.errorMessage != nil {
                VStack {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                        .font(.largeTitle)
                    Text("Error: Please allow SyncNos to access Apple Books notes; otherwise they cannot be loaded.")
                        .multilineTextAlignment(.center)
                        .padding()
                    Button("Open Apple Books notes", systemImage: "folder") {
                        AppleBooksPicker.pickAppleBooksContainer()
                    }
                }
            } else if viewModel.books.isEmpty {
                VStack {
                    Image(systemName: "books.vertical")
                        .foregroundColor(.secondary)
                        .font(.largeTitle)
                    Text("No books found")
                        .padding()
                    Button("Open Apple Books notes", systemImage: "folder") {
                        AppleBooksPicker.pickAppleBooksContainer()
                    }
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleBooks, id: \.bookId) { book in
                        HStack {
                            VStack(alignment: .leading) {
                                if book.hasTitle {
                                    Text(book.bookTitle).font(.headline)
                                } else {
                                    Text("No Title").font(.headline).foregroundColor(.orange)
                                }
                                Text(book.authorName).font(.subheadline).foregroundColor(.secondary)
                                Text("\(book.highlightCount) highlights").font(.caption)
                            }
                            Spacer()
                            // Sync status icon
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
                            // Open in Apple Books (if available)
                            if let ibooksURLString = book.ibooksURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed), let ibooksURL = URL(string: ibooksURLString) {
                                Button {
                                    NSWorkspace.shared.open(ibooksURL)
                                } label: {
                                    Label("Open in Apple Books", systemImage: "book")
                                }
                            }

                            Button {
                                viewModel.batchSync(bookIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                            } label: {
                                Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle")
                            }

                            // 显示上次同步时间（针对当前右键的行）
                            Divider()
                            let last = viewModel.lastSync(for: book.bookId)
                            if let lastDate = last {
                                Text("Last Sync Time") + Text(": ") + Text(DateFormatter.localizedString(from: lastDate, dateStyle: .short, timeStyle: .short))
                            } else {
                                Text("Last Sync Time") + Text(": ") + Text("-")
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
                .focused($isListFocused)
            }
        }
        .onAppear {
            // 切换到 Apple Books 时，确保第一帧进入加载态，然后异步加载/重算
            viewModel.triggerRecompute()
            _ = viewModel.restoreBookmarkAndConfigureRoot()
            if viewModel.books.isEmpty {
                Task {
                    await viewModel.loadBooks()
                }
            }
            // 延迟获取焦点，确保视图已完全加载
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToAppleBooks")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
        .onDisappear {
            viewModel.stopAccessingIfNeeded()
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
