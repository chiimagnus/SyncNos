import SwiftUI
import AppKit
import Combine

struct MainListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue

    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    @StateObject private var goodLinksVM = GoodLinksViewModel()

    var body: some View {
        NavigationSplitView {
            Group {
                if contentSource == .goodLinks {
                    GoodLinksListView(viewModel: goodLinksVM, selectedLinkId: $selectedBookId)
                } else {
                    AppleBooksListView(viewModel: viewModel, selectedBookId: $selectedBookId)
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
                GoodLinksDetailView(viewModel: goodLinksVM, selectedLinkId: $selectedBookId)
            } else {
                AppleBookDetailView(viewModelList: viewModel, selectedBookId: $selectedBookId)
            }
        }
        .onChange(of: contentSourceRawValue) { _ in
            // 切换数据源时重置选择
            selectedBookId = nil
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
