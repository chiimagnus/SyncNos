import SwiftUI

struct GoodLinksListView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectionIds: Set<String>

    var body: some View {
        Group {
            if viewModel.isLoading {
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
                // .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                // .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $selectionIds) {
                    ForEach(viewModel.displayLinks, id: \.id) { link in
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
                                    .help("Syncing")
                            } else if viewModel.syncedLinkIds.contains(link.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .help("Synced")
                            }
                        }
                        .padding(.vertical, 4)
                        .tag(link.id)
                        .contextMenu {
                            Button {
                                viewModel.batchSync(linkIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                            } label: {
                                Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle")
                            }

                            // 显示上次同步时间，仅在单选且该项被选中时显示
                            if selectionIds.count == 1 && selectionIds.contains(link.id) {
                                Divider()
                                let last = SyncTimestampStore.shared.getLastSyncTime(for: link.id)
                                if let lastDate = last {
                                    Text("Last Sync: \(DateFormatter.localizedString(from: lastDate, dateStyle: .short, timeStyle: .short))")
                                } else {
                                    Text("Last Sync: Never")
                                }
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .onAppear {
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
        .onDisappear {
            GoodLinksBookmarkStore.shared.stopAccessingIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SelectAllRequested")).receive(on: DispatchQueue.main)) { _ in
            let all = Set(viewModel.displayLinks.map { $0.id })
            if !all.isEmpty { selectionIds = all }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DeselectAllRequested")).receive(on: DispatchQueue.main)) { _ in
            selectionIds.removeAll()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncSelectedToNotionRequested")).receive(on: DispatchQueue.main)) { _ in
            viewModel.batchSync(linkIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
        }
    }
}
