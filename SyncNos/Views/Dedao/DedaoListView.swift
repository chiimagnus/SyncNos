import SwiftUI

struct DedaoListView: View {
    @ObservedObject var viewModel: DedaoViewModel
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
                        viewModel.navigateToDedaoLogin()
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
                    Button {
                        Task {
                            await viewModel.forceRefresh()
                        }
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                }
            } else if viewModel.books.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "d.square")
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
            // 获取焦点（避免额外延迟引入的竞态）
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        .task(id: viewModel.isLoggedIn) {
            viewModel.triggerRecompute()
            if viewModel.books.isEmpty && viewModel.isLoggedIn {
                await viewModel.loadBooks()
            }
        }
        // 监听 List 焦点请求通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: ContentSource.dedao.listFocusRequestedNotification).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // SyncSelectedToNotionRequested、RefreshBooksRequested、Notion 配置弹窗、会话过期弹窗已移至 MainListView 统一处理
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToDedaoSettings")).receive(on: DispatchQueue.main)) { _ in
            // 打开设置窗口
            openWindow(id: "setting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                NotificationCenter.default.post(name: Notification.Name("NavigateToDedaoLogin"), object: nil)
            }
        }
        .onDisappear {
            viewModel.purgeMemory()
        }
        .sheet(isPresented: $viewModel.showLoginSheet) {
            DedaoLoginView(viewModel: DedaoLoginViewModel(
                authService: DIContainer.shared.dedaoAuthService,
                apiService: DIContainer.shared.dedaoAPIService
            )) {
                // 登录成功后触发 UI 更新并刷新书籍列表
                viewModel.onLoginSuccess()
            }
        }
    }
}

