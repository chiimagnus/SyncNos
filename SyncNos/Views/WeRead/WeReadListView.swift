import SwiftUI

struct WeReadListView: View {
    @ObservedObject var viewModel: WeReadViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool

    var body: some View {
        Group {
            if !viewModel.isLoggedIn {
                // 未登录状态
                VStack(spacing: 16) {
                    Image(systemName: "person.crop.circle.badge.questionmark")
                        .scaledFont(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("Not Logged In")
                        .scaledFont(.headline, weight: .semibold)
                        .foregroundColor(.secondary)
                    Button {
                        viewModel.navigateToWeReadLogin()
                    } label: {
                        Label("Log In", systemImage: "qrcode")
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else if viewModel.isLoading || viewModel.isComputingList {
                ProgressView("Loading...")
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                        .scaledFont(.title)
                    Text(error)
                        .scaledFont(.body)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            } else if viewModel.books.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "w.square")
                        .foregroundColor(.secondary)
                        .scaledFont(.title)
                    Text("No books found")
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleBooks, id: \.bookId) { book in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(book.title)
                                    .scaledFont(.headline, weight: .semibold)
                                    .lineLimit(2)
                                if !book.author.isEmpty {
                                    Text(book.author)
                                        .scaledFont(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                Text("\(book.highlightCount) highlights")
                                    .scaledFont(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            if viewModel.syncingBookIds.contains(book.bookId) {
                                Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
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
                            SyncSelectedToNotionContextMenuItem(selectionIds: selectionIds, fallbackId: book.bookId) { ids in
                                viewModel.batchSync(bookIds: ids, concurrency: NotionSyncConfig.batchConcurrency)
                            }

                            NotionOpenContextMenuItem(sourceKey: "weRead", assetId: book.bookId)

                            LastSyncTimeContextMenuSection(lastSyncAt: viewModel.lastSync(for: book.bookId))
                        }
                    }
                }
                .listStyle(.sidebar)
                .focused($isListFocused)
            }
        }
        .onAppear {
            viewModel.triggerRecompute()
            // 不依赖 isLoggedIn（Keychain / cookieHeader 读取可能晚于 onAppear），由 VM 内部自行判断并更新登录态
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
        .onReceive(NotificationCenter.default.publisher(for: ContentSource.weRead.listFocusRequestedNotification).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // SyncSelectedToNotionRequested、RefreshBooksRequested、Notion 配置弹窗、会话过期弹窗已移至 MainListView 统一处理
        .onReceive(NotificationCenter.default.publisher(for: .navigateToWeReadSettings).receive(on: DispatchQueue.main)) { _ in
            // 打开设置窗口并跳转到 Site Logins
            openWindow(id: "setting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                NotificationCenter.default.post(name: .navigateToSiteLogins, object: nil, userInfo: ["source": ContentSource.weRead.rawValue])
            }
        }
        .sheet(isPresented: $viewModel.showLoginSheet) {
            WeReadLoginView {
                // 登录成功后触发 UI 更新并刷新书籍列表
                viewModel.onLoginSuccess()
            }
        }
    }
}
