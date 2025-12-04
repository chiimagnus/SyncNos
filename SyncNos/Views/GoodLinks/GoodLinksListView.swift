import SwiftUI
import AppKit

struct GoodLinksListView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
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
                        .scaledFont(.title)
                    Text(error)
                        .scaledFont(.body)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Button {
                        GoodLinksPicker.pickGoodLinksFolder()
                    } label: {
                        Label("Select Folder", systemImage: "folder")
                    }
                }
            } else if viewModel.links.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "link")
                        .foregroundColor(.secondary)
                        .scaledFont(.title)
                    Text("No links found")
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                    Button {
                        GoodLinksPicker.pickGoodLinksFolder()
                    } label: {
                        Label("Select Folder", systemImage: "folder")
                    }
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleLinks, id: \.id) { link in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(link.title?.isEmpty == false ? link.title! : link.url)
                                    .scaledFont(.headline, weight: .semibold)
                                    .lineLimit(2)
                                if let author = link.author, !author.isEmpty {
                                    Text(author)
                                        .scaledFont(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                HStack(spacing: 8) {
                                    if let cnt = link.highlightTotal {
                                        Text("\(cnt) highlights")
                                            .scaledFont(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    Text(URL(string: link.url)?.host ?? "")
                                        .scaledFont(.caption)
                                        .foregroundColor(.secondary)
                                    if link.starred {
                                        Image(systemName: "star.fill")
                                            .foregroundColor(.yellow)
                                            .scaledFont(.caption)
                                    }
                                }
                                let tagsText = link.tagsFormatted
                                if !tagsText.isEmpty {
                                    Text(tagsText)
                                        .scaledFont(.caption2)
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            // Sync status icon (与 AppleBooksListView 保持一致)
                            if viewModel.syncingLinkIds.contains(link.id) {
                                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                                    .foregroundColor(.yellow)
                                    .help("Syncing...")
                            } else if viewModel.syncedLinkIds.contains(link.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .help("Synced")
                            }
                        }
                        .padding(.vertical, 4)
                        .tag(link.id)
                        .onAppear {
                            // 当行即将出现在屏幕底部附近时，尝试加载更多数据
                            viewModel.loadMoreIfNeeded(currentItem: link)
                        }
                        .contextMenu {
                            // Open in GoodLinks
                            if let openURL = URL(string: link.openInGoodLinksURLString) {
                                Button {
                                    NSWorkspace.shared.open(openURL)
                                } label: {
                                    Label("Open in GoodLinks", systemImage: "link")
                                }
                            }

                            Button {
                                viewModel.batchSync(linkIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                            } label: {
                                Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle")
                            }

                            // 显示上次同步时间（针对当前右键的行）
                            Divider()
                            let last = viewModel.lastSync(for: link.id)
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
            // 切换到 GoodLinks 时，确保第一帧进入加载态，然后异步加载/重算
            viewModel.triggerRecompute()
            if viewModel.links.isEmpty {
                Task {
                    await viewModel.loadRecentLinks()
                }
            }
            // 延迟获取焦点，确保视图已完全加载
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToGoodLinks")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")).receive(on: DispatchQueue.main)) { _ in
            Task {
                await viewModel.loadRecentLinks()
            }
        }
        // 注意：不要在 onDisappear 中强制关闭 GoodLinks 的安全范围访问，
        // 以免在自动同步或后台同步仍在访问数据库时导致权限被撤销（authorization denied）。
        // 安全范围生命周期由 GoodLinksBookmarkStore 自身和自动同步 Provider 统一管理。
        // SyncSelectedToNotionRequested、RefreshBooksRequested、Notion 配置弹窗已移至 MainListView 统一处理
    }
}
