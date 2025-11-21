import SwiftUI
import AppKit

struct MainListView: View {
    @StateObject private var viewModel = AppleBooksViewModel()
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @State private var selectedWeReadBookIds: Set<String> = []
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @Environment(\.openWindow) private var openWindow

    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    @StateObject private var goodLinksVM = GoodLinksViewModel()
    @StateObject private var weReadVM = WeReadViewModel()

    var body: some View {
        NavigationSplitView {
            Group {
                switch contentSource {
                case .goodLinks:
                    GoodLinksListView(viewModel: goodLinksVM, selectionIds: $selectedLinkIds)
                case .appleBooks:
                    AppleBooksListView(viewModel: viewModel, selectionIds: $selectedBookIds)
                case .weRead:
                    WeReadListView(viewModel: weReadVM, selectionIds: $selectedWeReadBookIds)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
            .toolbar {
                // 数据源切换菜单 + Articles 排序筛选（集成在同一菜单中）
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        // 数据源切换部分
                        Section("Data Source") {
                            Button {
                                contentSourceRawValue = ContentSource.appleBooks.rawValue
                            } label: {
                                HStack {
                                    Text("Apple Books (\(viewModel.displayBooks.count)/\(viewModel.books.count))")
                                    if contentSource == .appleBooks { Image(systemName: "checkmark") }
                                }
                            }

                            Button {
                                contentSourceRawValue = ContentSource.goodLinks.rawValue
                            } label: {
                                HStack {
                                    Text("GoodLinks (\(goodLinksVM.displayLinks.count)/\(goodLinksVM.links.count))")
                                    if contentSource == .goodLinks { Image(systemName: "checkmark") }
                                }
                            }

                            Button {
                                contentSourceRawValue = ContentSource.weRead.rawValue
                            } label: {
                                HStack {
                                    Text("WeRead (\(weReadVM.displayBooks.count)/\(weReadVM.books.count))")
                                    if contentSource == .weRead { Image(systemName: "checkmark") }
                                }
                            }
                        }
                        // 排序和筛选部分（根据数据源显示对应选项）
                        if contentSource == .appleBooks {
                            Divider()

                            Section("Sort") {
                                ForEach(BookListSortKey.allCases, id: \.self) { key in
                                    Button {
                                        viewModel.sortKey = key
                                        NotificationCenter.default.post(
                                            name: Notification.Name("AppleBooksFilterChanged"),
                                            object: nil,
                                            userInfo: ["sortKey": key.rawValue]
                                        )
                                    } label: {
                                        if viewModel.sortKey == key {
                                            Label(key.displayName, systemImage: "checkmark")
                                        } else {
                                            Text(key.displayName)
                                        }
                                    }
                                }

                                Divider()

                                Button {
                                    viewModel.sortAscending.toggle()
                                    NotificationCenter.default.post(
                                        name: Notification.Name("AppleBooksFilterChanged"),
                                        object: nil,
                                        userInfo: ["sortAscending": viewModel.sortAscending]
                                    )
                                } label: {
                                    if viewModel.sortAscending {
                                        Label("Ascending", systemImage: "checkmark")
                                    } else {
                                        Label("Ascending", systemImage: "xmark")
                                    }
                                }
                            }

                            Section("Filter") {
                                Button {
                                    viewModel.showWithTitleOnly.toggle()
                                    NotificationCenter.default.post(
                                        name: Notification.Name("AppleBooksFilterChanged"),
                                        object: nil,
                                        userInfo: ["showWithTitleOnly": viewModel.showWithTitleOnly]
                                    )
                                } label: {
                                    if viewModel.showWithTitleOnly {
                                        Label("Titles only", systemImage: "checkmark")
                                    } else {
                                        Text("Titles only")
                                    }
                                }
                            }
                        } else if contentSource == .goodLinks {
                            Divider()

                            Section("Sort") {
                                ForEach(GoodLinksSortKey.allCases, id: \.self) { key in
                                    Button {
                                        goodLinksVM.sortKey = key
                                        NotificationCenter.default.post(
                                            name: Notification.Name("GoodLinksFilterChanged"),
                                            object: nil,
                                            userInfo: ["sortKey": key.rawValue]
                                        )
                                    } label: {
                                        if goodLinksVM.sortKey == key {
                                            Label(key.displayName, systemImage: "checkmark")
                                        } else {
                                            Text(key.displayName)
                                        }
                                    }
                                }

                                Divider()

                                Button {
                                    goodLinksVM.sortAscending.toggle()
                                    NotificationCenter.default.post(
                                        name: Notification.Name("GoodLinksFilterChanged"),
                                        object: nil,
                                        userInfo: ["sortAscending": goodLinksVM.sortAscending]
                                    )
                                } label: {
                                    if goodLinksVM.sortAscending {
                                        Label("Ascending", systemImage: "checkmark")
                                    } else {
                                        Label("Ascending", systemImage: "xmark")
                                    }
                                }
                            }

                            Section("Filter") {
                                Button {
                                    goodLinksVM.showStarredOnly.toggle()
                                    NotificationCenter.default.post(
                                        name: Notification.Name("GoodLinksFilterChanged"),
                                        object: nil,
                                        userInfo: ["showStarredOnly": goodLinksVM.showStarredOnly]
                                    )
                                } label: {
                                    if goodLinksVM.showStarredOnly {
                                        Label("Starred only", systemImage: "checkmark")
                                    } else {
                                        Text("Starred only")
                                    }
                                }
                            }
                        }
                    } label: {
                        // 显示数据源名称而不是图标
                        Text(contentSource.title)
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
                    GoodLinksDetailView(viewModel: goodLinksVM, selectedLinkId: singleLinkBinding)
                } else {
                    SelectionPlaceholderView(
                        title: contentSource.title,
                        count: selectedLinkIds.isEmpty ? nil : selectedLinkIds.count,
                        onSyncSelected: selectedLinkIds.isEmpty ? nil : {
                            let items = selectedLinkIds.compactMap { id -> [String: Any]? in
                                guard let link = goodLinksVM.displayLinks.first(where: { $0.id == id }) else { return nil }
                                let title = (link.title?.isEmpty == false ? link.title! : link.url)
                                return ["id": id, "title": title, "subtitle": link.author ?? ""]
                            }
                            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": "goodLinks", "items": items])
                            goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
                        }
                    )
                }
            } else if contentSource == .appleBooks {
                if selectedBookIds.count == 1 {
                    let singleBookBinding = Binding<String?>(
                        get: { selectedBookIds.first },
                        set: { new in selectedBookIds = new.map { Set([$0]) } ?? [] }
                    )
                    AppleBooksDetailView(viewModelList: viewModel, selectedBookId: singleBookBinding)
                } else {
                    SelectionPlaceholderView(
                        title: contentSource.title,
                        count: selectedBookIds.isEmpty ? nil : selectedBookIds.count,
                        onSyncSelected: selectedBookIds.isEmpty ? nil : {
                            let items = selectedBookIds.compactMap { id -> [String: Any]? in
                                guard let b = viewModel.displayBooks.first(where: { $0.bookId == id }) else { return nil }
                                return ["id": id, "title": b.bookTitle, "subtitle": b.authorName]
                            }
                            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": "appleBooks", "items": items])
                            viewModel.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
                        }
                    )
                }
            } else {
                if contentSource == .weRead {
                    if selectedWeReadBookIds.count == 1 {
                        let singleWeReadBinding = Binding<String?>(
                            get: { selectedWeReadBookIds.first },
                            set: { new in selectedWeReadBookIds = new.map { Set([$0]) } ?? [] }
                        )
                        WeReadDetailView(listViewModel: weReadVM, selectedBookId: singleWeReadBinding)
                    } else {
                        SelectionPlaceholderView(
                            title: contentSource.title,
                            count: selectedWeReadBookIds.isEmpty ? nil : selectedWeReadBookIds.count,
                            onSyncSelected: selectedWeReadBookIds.isEmpty ? nil : {
                                let items = selectedWeReadBookIds.compactMap { id -> [String: Any]? in
                                    guard let b = weReadVM.displayBooks.first(where: { $0.bookId == id }) else { return nil }
                                    return ["id": id, "title": b.title, "subtitle": b.author]
                                }
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncTasksEnqueued"),
                                    object: nil,
                                    userInfo: ["source": "weRead", "items": items]
                                )
                                weReadVM.batchSync(bookIds: selectedWeReadBookIds, concurrency: NotionSyncConfig.batchConcurrency)
                            }
                        )
                    }
                } else {
                    // 理论上不会走到这里，因为 contentSource 只有三种情况
                    SelectionPlaceholderView(
                        title: contentSource.title,
                        count: nil,
                        onSyncSelected: nil
                    )
                }
            }
        }
        .onChange(of: contentSourceRawValue) { _, _ in
            // 切换数据源时重置选择
            selectedBookIds.removeAll()
            selectedLinkIds.removeAll()
            selectedWeReadBookIds.removeAll()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncQueueTaskSelected")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let source = info["source"] as? String, let id = info["id"] as? String else { return }
            if source == ContentSource.appleBooks.rawValue {
                contentSourceRawValue = ContentSource.appleBooks.rawValue
                selectedLinkIds.removeAll()
                selectedWeReadBookIds.removeAll()
                selectedBookIds = Set([id])
            } else if source == ContentSource.goodLinks.rawValue {
                contentSourceRawValue = ContentSource.goodLinks.rawValue
                selectedBookIds.removeAll()
                selectedWeReadBookIds.removeAll()
                selectedLinkIds = Set([id])
            } else if source == ContentSource.weRead.rawValue {
                contentSourceRawValue = ContentSource.weRead.rawValue
                selectedBookIds.removeAll()
                selectedLinkIds.removeAll()
                selectedWeReadBookIds = Set([id])
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
        .alert("Notion Configuration Required", isPresented: $goodLinksVM.showNotionConfigAlert) {
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

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
