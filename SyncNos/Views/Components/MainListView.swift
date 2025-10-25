import SwiftUI
import AppKit

struct MainListView: View {
    @StateObject private var viewModel = AppleBookViewModel()
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
                    GoodLinksListView(selectionIds: $selectedLinkIds)
                        .environmentObject(goodLinksVM)
                } else {
                    AppleBooksListView(selectionIds: $selectedBookIds)
                        .environmentObject(viewModel)
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
            }
        } detail: {
            if contentSource == .goodLinks {
                if selectedLinkIds.count == 1 {
                    let singleLinkBinding = Binding<String?>(
                        get: { selectedLinkIds.first },
                        set: { new in selectedLinkIds = new.map { Set([$0]) } ?? [] }
                    )
                    GoodLinksDetailView(selectedLinkId: singleLinkBinding)
                        .environmentObject(goodLinksVM)
                } else if selectedLinkIds.count > 1 {
                    MultipleSelectionPlaceholderView(count: selectedLinkIds.count) {
                        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
                    }
                } else {
                    VStack {
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
                    AppleBookDetailView(selectedBookId: singleBookBinding)
                        .environmentObject(viewModel)
                } else if selectedBookIds.count > 1 {
                    MultipleSelectionPlaceholderView(count: selectedBookIds.count) {
                        viewModel.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
                    }
                } else {
                    VStack {
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
            // 在切换到 GoodLinks 前预置计算标记，确保首帧进入“加载中”占位
            if contentSource == .goodLinks {
                goodLinksVM.prepareForDisplaySwitch()
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
