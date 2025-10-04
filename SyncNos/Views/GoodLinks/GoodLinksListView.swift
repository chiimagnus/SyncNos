import SwiftUI

struct GoodLinksListView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?

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
                List(selection: $selectedLinkId) {
                    ForEach(viewModel.links, id: \.id) { link in
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(link.title?.isEmpty == false ? link.title! : link.url)
                                    .font(.headline)
                                    .lineLimit(2)
                                if let author = link.author, !author.isEmpty {
                                    Text(author).font(.subheadline).foregroundColor(.secondary)
                                }
                                HStack(spacing: 8) {
                                    // 优先使用从 DB 聚合得到的计数映射，其次回退到 link.highlightTotal
                                    let dbCount = viewModel.highlightCountsByLinkId[link.id]
                                    if let cnt = dbCount ?? link.highlightTotal {
                                        Text("\(cnt) highlights").font(.caption).foregroundColor(.secondary)
                                    }
                                    Text(URL(string: link.url)?.host ?? "").font(.caption).foregroundColor(.secondary)
                                    if link.starred {
                                        Image(systemName: "star.fill").foregroundColor(.yellow).font(.caption)
                                    }
                                }
                                if let tags = link.tags, !tags.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    Text(tags)
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                        .tag(link.id)
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .onAppear {
            if viewModel.links.isEmpty {
                viewModel.loadRecentLinks()
            }
            // 默认选中第一条（若未选中且有数据）
            if selectedLinkId == nil, let firstId = viewModel.links.first?.id {
                selectedLinkId = firstId
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")).receive(on: DispatchQueue.main)) { _ in
            viewModel.loadRecentLinks()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
            viewModel.loadRecentLinks()
        }
        .onChange(of: viewModel.links) { links in
            if selectedLinkId == nil, let firstId = links.first?.id {
                selectedLinkId = firstId
            }
        }
        .onDisappear {
            GoodLinksBookmarkStore.shared.stopAccessingIfNeeded()
        }
    }
}
