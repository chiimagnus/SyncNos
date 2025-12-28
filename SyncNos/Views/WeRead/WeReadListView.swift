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
            viewModel.triggerRecompute()
            if viewModel.books.isEmpty && viewModel.isLoggedIn {
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToWeRead")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
        // 监听焦点状态更新通知（鼠标点击 DetailView 时同步焦点状态）
        .onReceive(NotificationCenter.default.publisher(for: .listViewShouldUpdateFocus).receive(on: DispatchQueue.main)) { notification in
            // 只处理发给当前数据源的通知
            guard let source = notification.userInfo?["source"] as? String,
                  source == ContentSource.weRead.rawValue else { return }
            
            if let focused = notification.userInfo?["focused"] as? Bool {
                isListFocused = focused
            }
        }
        // SyncSelectedToNotionRequested、RefreshBooksRequested、Notion 配置弹窗、会话过期弹窗已移至 MainListView 统一处理
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToWeReadSettings")).receive(on: DispatchQueue.main)) { _ in
            // 打开设置窗口，SettingsView 会监听 NavigateToWeReadLogin 通知并导航到 WeReadSettingsView
            openWindow(id: "setting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                NotificationCenter.default.post(name: Notification.Name("NavigateToWeReadLogin"), object: nil)
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
