import SwiftUI
import AppKit
import Combine

struct BooksListView: View {
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
                                Text("Apple Books")
                                if contentSource == .appleBooks { Image(systemName: "checkmark") }
                            }
                        }

                        Button {
                            contentSourceRawValue = ContentSource.goodLinks.rawValue
                        } label: {
                            HStack {
                                Text("GoodLinks")
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
                AppleBooksDetailContainerView(viewModel: viewModel, selectedBookId: $selectedBookId)
            }
        }
        .onChange(of: contentSourceRawValue) { _ in
            // 切换数据源时重置选择
            selectedBookId = nil
            if contentSource == .goodLinks {
                goodLinksVM.loadRecentLinks()
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

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
