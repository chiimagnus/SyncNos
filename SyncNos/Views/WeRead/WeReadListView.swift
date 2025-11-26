import SwiftUI
import AppKit

struct WeReadListView: View {
    @ObservedObject var viewModel: WeReadViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool

    var body: some View {
        Group {
            if viewModel.isLoading || viewModel.isComputingList {
                ProgressView("Loading...")
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
                                Text("\(book.highlightCount) highlights")
                                    .font(.caption)
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToWeRead")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
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
        .alert(
            NSLocalizedString("Session Expired", comment: ""),
            isPresented: $viewModel.showRefreshFailedAlert
        ) {
            Button(NSLocalizedString("Remind Me Later", comment: ""), role: .cancel) {
                // 关闭弹窗，稍后提醒
            }
            Button(NSLocalizedString("Go to Login", comment: "")) {
                viewModel.navigateToWeReadLogin()
            }
        } message: {
            Text(viewModel.refreshFailureReason)
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
            Task {
                await viewModel.loadBooks()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("NavigateToWeReadSettings")).receive(on: DispatchQueue.main)) { _ in
            // 打开设置窗口，SettingsView 会监听 NavigateToWeReadLogin 通知并导航到 WeReadSettingsView
            openWindow(id: "setting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                NotificationCenter.default.post(name: Notification.Name("NavigateToWeReadLogin"), object: nil)
            }
        }
    }
}
