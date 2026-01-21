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
                    
                    Text(String(localized: "Access Denied", table: "AppleBooks"))
                        .scaledFont(.headline)
                    
                    Text(String(localized: "SyncNos needs permission to access Apple Books notes. If you previously selected \"Don't Allow\", please restart the app and select \"Allow\" when prompted.", table: "AppleBooks"))
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)
                    
                    VStack(spacing: 12) {
                        Button(String(localized: "Restart", table: "Common"), systemImage: "arrow.clockwise") {
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
                        
                        Button(String(localized: "Select Folder", table: "Common"), systemImage: "folder") {
                            AppleBooksPicker.pickAppleBooksContainer()
                        }
                    }
                }
            } else if viewModel.books.isEmpty {
                VStack {
                    Image(systemName: "books.vertical")
                        .foregroundColor(.secondary)
                        .scaledFont(.largeTitle)
                    Text(String(localized: "No books found", table: "Common"))
                        .scaledFont(.body)
                        .padding()
                    Button(String(localized: "Open Apple Books notes", table: "AppleBooks"), systemImage: "folder") {
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
                                    Text(String(localized: "No Title", table: "AppleBooks"))
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
                                Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                                    .foregroundColor(.yellow)
                                    .help(String(localized: "Syncing...", table: "Common"))
                            } else if viewModel.syncedBookIds.contains(book.bookId) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .help(String(localized: "Synced", table: "Common"))
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
                                    Label(String(localized: "Open in Apple Books", table: "AppleBooks"), systemImage: "book")
                                }
                            }

                            Button {
                                viewModel.batchSync(bookIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                            } label: {
                                Label(String(localized: "Sync Selected to Notion", table: "Common"), systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                            }

                            // 显示上次同步时间（针对当前右键的行）
                            Divider()
                            let last = viewModel.lastSync(for: book.bookId)
                            if let lastDate = last {
                                Text(String(localized: "Last Sync Time", table: "Common")) + Text(String(localized: ": ", table: "Common")) + Text(DateFormatter.localizedString(from: lastDate, dateStyle: .short, timeStyle: .short))
                            } else {
                                Text(String(localized: "Last Sync Time", table: "Common")) + Text(String(localized: ": ", table: "Common")) + Text(String(localized: "-", table: "Common"))
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
        // 监听 List 焦点请求通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: ContentSource.appleBooks.listFocusRequestedNotification).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // 只监听 AppleBooksContainerSelected（用户选择数据库路径时）
        .onReceive(NotificationCenter.default.publisher(for: .appleBooksContainerSelected).receive(on: DispatchQueue.main)) { notification in
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
