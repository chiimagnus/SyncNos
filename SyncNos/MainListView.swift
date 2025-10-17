import SwiftUI
import AppKit

struct MainListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue

    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    @StateObject private var goodLinksVM = GoodLinksViewModel()

    var body: some View {
        NavigationSplitView {
            Group {
                if contentSource == .goodLinks {
                    GoodLinksListView(viewModel: goodLinksVM, selectionIds: $selectedLinkIds)
                } else {
                    AppleBooksListView(viewModel: viewModel, selectionIds: $selectedBookIds)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
            .toolbar {
                // 仅保留数据源切换菜单，具体过滤/排序由各自的 ListView 管理
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            contentSourceRawValue = ContentSource.appleBooks.rawValue
                        } label: {
                            HStack {
                                Text("AppleBooks-\(viewModel.books.count)")
                                if contentSource == .appleBooks { Image(systemName: "checkmark") }
                            }
                        }

                        Button {
                            contentSourceRawValue = ContentSource.goodLinks.rawValue
                        } label: {
                            HStack {
                                Text("GoodLinks-\(goodLinksVM.links.count)")
                                if contentSource == .goodLinks { Image(systemName: "checkmark") }
                            }
                        }
                    } label: {
                        Label(contentSource.title, systemImage: contentSource == .appleBooks ? "book" : "bookmark")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if contentSource == .goodLinks {
                            goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
                        } else {
                            viewModel.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
                        }
                    } label: {
                        Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled((contentSource == .goodLinks ? selectedLinkIds.isEmpty : selectedBookIds.isEmpty))
                    .help("Sync Selected to Notion")
                }
            }
        } detail: {
            if contentSource == .goodLinks {
                if selectedLinkIds.count == 1 {
                    let singleLinkBinding = Binding<String?>(
                        get: { selectedLinkIds.first },
                        set: { new in selectedLinkIds = new.map { Set([$0]) } ?? [] }
                    )
                    GoodLinksDetailView(viewModel: goodLinksVM, selectedLinkId: singleLinkBinding)
                } else if selectedLinkIds.count > 1 {
                    MultipleSelectionPlaceholderView(count: selectedLinkIds.count) {
                        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(contentSource.title)
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Please select an item").foregroundColor(.secondary)
                    }
                }
            } else {
                if selectedBookIds.count == 1 {
                    let singleBookBinding = Binding<String?>(
                        get: { selectedBookIds.first },
                        set: { new in selectedBookIds = new.map { Set([$0]) } ?? [] }
                    )
                    AppleBookDetailView(viewModelList: viewModel, selectedBookId: singleBookBinding)
                } else if selectedBookIds.count > 1 {
                    MultipleSelectionPlaceholderView(count: selectedBookIds.count) {
                        viewModel.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(contentSource.title)
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Please select an item").foregroundColor(.secondary)
                    }
                }
            }
        }
        .onChange(of: contentSourceRawValue) { _ in
            // 切换数据源时重置选择
            selectedBookIds.removeAll()
            selectedLinkIds.removeAll()
            if contentSource == .goodLinks {
                Task {
                    await goodLinksVM.loadRecentLinks()
                }
            }
        }
        .background {
            LinearGradient(
                gradient: Gradient(colors: [
                    Color.red.opacity(0.3),
                    Color.orange.opacity(0.3),
                    Color.yellow.opacity(0.3),
                    Color.green.opacity(0.3),
                    Color.blue.opacity(0.3),
                    Color.purple.opacity(0.3),
                    Color.pink.opacity(0.3)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        }
        .toolbarBackground(.hidden, for: .windowToolbar)
        
    }
}

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
