import SwiftUI
import AppKit

struct DedaoListView: View {
    @ObservedObject var viewModel: DedaoViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow
    @Environment(\.fontScale) private var fontScale
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool

    var body: some View {
        Group {
            if !viewModel.isLoggedIn {
                // 未登录状态
                VStack(spacing: 16) {
                    Image(systemName: "person.crop.circle.badge.questionmark")
                        .font(.system(size: 48 * fontScale))
                        .foregroundColor(.secondary)
                    Text("Not Logged In")
                        .font(.system(size: Font.TextStyle.headline.basePointSize * fontScale, weight: .semibold))
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
                        .font(.system(size: 26 * fontScale))
                    Text(error)
                        .font(.system(size: Font.TextStyle.body.basePointSize * fontScale))
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
                    Image(systemName: "text.book.closed")
                        .foregroundColor(.secondary)
                        .font(.system(size: 26 * fontScale))
                    Text("No books found")
                        .font(.system(size: Font.TextStyle.body.basePointSize * fontScale))
                        .foregroundColor(.secondary)
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleBooks, id: \.bookId) { book in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(book.title)
                                    .font(.system(size: Font.TextStyle.headline.basePointSize * fontScale, weight: .semibold))
                                    .lineLimit(2)
                                if !book.author.isEmpty {
                                    Text(book.author)
                                        .font(.system(size: Font.TextStyle.subheadline.basePointSize * fontScale))
                                        .foregroundColor(.secondary)
                                }
                                Text("\(book.highlightCount) highlights")
                                    .font(.system(size: Font.TextStyle.caption.basePointSize * fontScale))
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToDedao")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
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

