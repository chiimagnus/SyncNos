import SwiftUI

struct GoodLinksListView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectionIds: Set<String>
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Group {
            if viewModel.isLoading || viewModel.isComputingList {
                ProgressView("Loading links...")
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle").foregroundColor(.orange).font(.largeTitle)
                    Text(error).multilineTextAlignment(.center).padding(.horizontal)
                    Button {
                        GoodLinksPicker.pickGoodLinksFolder()
                    } label: {
                        Label("Open GoodLinks data", systemImage: "folder")
                    }
                }
            } else if viewModel.links.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "link").foregroundColor(.secondary).font(.largeTitle)
                    Text("No links found").foregroundColor(.secondary)
                    Button {
                        GoodLinksPicker.pickGoodLinksFolder()
                    } label: {
                        Label("Open GoodLinks data", systemImage: "folder")
                    }
                }
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.visibleLinks, id: \.id) { link in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(link.title?.isEmpty == false ? link.title! : link.url)
                                    .font(.headline)
                                    .lineLimit(2)
                                if let author = link.author, !author.isEmpty {
                                    Text(author).font(.subheadline).foregroundColor(.secondary)
                                }
                                HStack(spacing: 8) {
                                    if let cnt = link.highlightTotal { Text("\(cnt) highlights").font(.caption).foregroundColor(.secondary) }
                                    Text(URL(string: link.url)?.host ?? "").font(.caption).foregroundColor(.secondary)
                                    if link.starred {
                                        Image(systemName: "star.fill").foregroundColor(.yellow).font(.caption)
                                    }
                                }
                                let tagsText = link.tagsFormatted
                                if !tagsText.isEmpty {
                                    Text(tagsText)
                                        .font(.caption2)
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
                .focusedSceneValue(\.selectionCommands, SelectionCommands(
                    selectAll: {
                        let all = Set(viewModel.displayLinks.map { $0.id })
                        if !all.isEmpty { selectionIds = all }
                    },
                    deselectAll: {
                        selectionIds.removeAll()
                    },
                    canSelectAll: {
                        let total = viewModel.displayLinks.count
                        return total > 0 && selectionIds.count < total
                    },
                    canDeselect: {
                        !selectionIds.isEmpty
                    }
                ))
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
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")).receive(on: DispatchQueue.main)) { _ in
            Task {
                await viewModel.loadRecentLinks()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
            Task {
                await viewModel.loadRecentLinks()
            }
        }
        // 注意：不要在 onDisappear 中强制关闭 GoodLinks 的安全范围访问，
        // 以免在自动同步或后台同步仍在访问数据库时导致权限被撤销（authorization denied）。
        // 安全范围生命周期由 GoodLinksBookmarkStore 自身和自动同步 Provider 统一管理。
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncSelectedToNotionRequested")).receive(on: DispatchQueue.main)) { _ in
            viewModel.batchSync(linkIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
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
