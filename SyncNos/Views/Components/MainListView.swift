import SwiftUI
import AppKit

struct MainListView: View {
    @StateObject private var viewModel = AppleBooksViewModel()
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue

    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    @StateObject private var goodLinksVM = GoodLinksViewModel()
    // local keyboard monitor (Option + Command + Left/Right)
    @State private var localKeyMonitor: Any?

    var body: some View {
        NavigationSplitView {
            // Sidebar content (list). Toolbar buttons moved to window toolbar center.
            Group {
                if contentSource == .goodLinks {
                    GoodLinksListView(viewModel: goodLinksVM, selectionIds: $selectedLinkIds)
                } else {
                    AppleBooksListView(viewModel: viewModel, selectionIds: $selectedBookIds)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
            .toolbar {
                // Center toolbar items: make two simple icon buttons in the window toolbar center
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 0) {
                        // Emoji button for Apple Books
                        Button(action: { contentSourceRawValue = ContentSource.appleBooks.rawValue }) {
                            Text("📚")
                                .font(.system(size: 10))
                                .frame(width: 16, height: 16)
                                .grayscale(contentSource == .appleBooks ? 0 : 1)
                                .opacity(contentSource == .appleBooks ? 1.0 : 0.45)
                        }
                        // .buttonStyle(.plain)
                        .help("Apple Books")

                        // Emoji button for GoodLinks
                        Button(action: { contentSourceRawValue = ContentSource.goodLinks.rawValue }) {
                            Text("🔖")
                                .font(.system(size: 10))
                                .frame(width: 16, height: 16)
                                .grayscale(contentSource == .goodLinks ? 0 : 1)
                                .opacity(contentSource == .goodLinks ? 1.0 : 0.45)
                        }
                        // .buttonStyle(.plain)
                        .help("GoodLinks")
                    }
                }

                // 数据源切换菜单 + Articles 排序筛选（集成在同一菜单中）
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        // 数据源切换部分
                        Button {
                            contentSourceRawValue = ContentSource.appleBooks.rawValue
                        } label: {
                            HStack {
                                Text("AppleBooks (\(viewModel.displayBooks.count)/\(viewModel.books.count))")
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
            } else {
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
            }
        }
        .onAppear {
            // install local key monitor for Option+Cmd+Left/Right to switch sources
            localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                if flags.contains([.command, .option]) {
                    switch event.keyCode {
                    case 123: // left arrow
                        contentSourceRawValue = ContentSource.appleBooks.rawValue
                        return nil
                    case 124: // right arrow
                        contentSourceRawValue = ContentSource.goodLinks.rawValue
                        return nil
                    default:
                        break
                    }
                }
                return event
            }
        }
        .onDisappear {
            if let monitor = localKeyMonitor {
                NSEvent.removeMonitor(monitor)
                localKeyMonitor = nil
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncQueueTaskSelected")).receive(on: DispatchQueue.main)) { n in
            guard let info = n.userInfo as? [String: Any], let source = info["source"] as? String, let id = info["id"] as? String else { return }
            if source == ContentSource.appleBooks.rawValue {
                contentSourceRawValue = ContentSource.appleBooks.rawValue
                selectedLinkIds.removeAll()
                selectedBookIds = Set([id])
            } else if source == ContentSource.goodLinks.rawValue {
                contentSourceRawValue = ContentSource.goodLinks.rawValue
                selectedBookIds.removeAll()
                selectedLinkIds = Set([id])
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
