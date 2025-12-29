import SwiftUI

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
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                        .scaledFont(.largeTitle)
                    
                    Text("Access Denied")
                        .scaledFont(.headline)
                    
                    Text("SyncNos needs permission to access Apple Books notes. If you previously selected \"Don't Allow\", please restart the app and select \"Allow\" when prompted.")
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)
                    
                    VStack(spacing: 12) {
                        Button("Restart", systemImage: "arrow.clockwise") {
                            // 重启应用
                            let task = Process()
                            task.launchPath = "/usr/bin/open"
                            task.arguments = ["-n", Bundle.main.bundlePath]
                            task.launch()
                            
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                                NSApplication.shared.terminate(nil)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        
                        Button("Select Folder", systemImage: "folder") {
                            AppleBooksPicker.pickAppleBooksContainer()
                        }
                    }
                }
            } else if viewModel.books.isEmpty {
                VStack {
                    Image(systemName: "books.vertical")
                        .foregroundColor(.secondary)
                        .scaledFont(.largeTitle)
                    Text("No books found")
                        .scaledFont(.body)
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
                                    Text(book.bookTitle)
                                        .scaledFont(.headline, weight: .semibold)
                                } else {
                                    Text("No Title")
                                        .scaledFont(.headline, weight: .semibold)
                                        .foregroundColor(.orange)
                                }
                                Text(book.authorName)
                                    .scaledFont(.subheadline)
                                    .foregroundColor(.secondary)
                                Text("\(book.highlightCount) highlights")
                                    .scaledFont(.caption)
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
            // 获取焦点（避免额外延迟引入的竞态）
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToAppleBooks")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        .onDisappear {
            viewModel.stopAccessingIfNeeded()
        }
        // 只监听 AppleBooksContainerSelected（用户选择数据库路径时）
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected")).receive(on: DispatchQueue.main)) { notification in
            guard let selectedPath = notification.object as? String else { return }
            let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
            viewModel.setDbRootOverride(rootCandidate)
            Task {
                await viewModel.loadBooks()
            }
        }
        // SyncSelectedToNotionRequested、RefreshBooksRequested、Notion 配置弹窗已移至 MainListView 统一处理
    }
}
