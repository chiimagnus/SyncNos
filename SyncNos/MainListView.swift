import SwiftUI
import AppKit
import Combine

struct MainListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil
    @AppStorage("backgroundImageEnabled") private var backgroundImageEnabled: Bool = false
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

                // Filter/sort menu for AppleBooks only
                if contentSource == .appleBooks {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            // Sort options submenu
                            Menu("排序", systemImage: "arrow.up.arrow.down") {
                                Picker("排序方式", selection: $viewModel.sort.key) {
                                    ForEach(BookListSortKey.allCases, id: \.self) { key in
                                        Text(key.displayName).tag(key)
                                    }
                                }

                                Divider()

                                Toggle("升序", isOn: $viewModel.sort.ascending)
                                    .onChange(of: viewModel.sort.ascending) { _ in
                                        // This will trigger the displayBooks computation
                                    }
                            }

                            Divider()

                            // Filter options
                            Toggle("仅显示有书名", isOn: $viewModel.showWithTitleOnly)
                        } label: {
                            Label("过滤", systemImage: "line.3.horizontal.decrease.circle")
                        }
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
            if backgroundImageEnabled {
                // 使用彩虹渐变背景
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
            } else {
                // 使用默认的背景
                Color.clear
            }
        }
        .toolbarBackground(.hidden, for: .windowToolbar)
        
    }
}

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
