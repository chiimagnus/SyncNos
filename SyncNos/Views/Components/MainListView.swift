import SwiftUI
import AppKit

struct MainListView: View {
    // MARK: - State Objects
    
    @StateObject private var dataSourceSwitchVM = DataSourceSwitchViewModel()
    @StateObject private var appleBooksVM = AppleBooksViewModel()
    @StateObject private var goodLinksVM = GoodLinksViewModel()
    @StateObject private var weReadVM = WeReadViewModel()
    
    // MARK: - Selection State
    
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @State private var selectedWeReadBookIds: Set<String> = []
    
    // MARK: - App Storage
    
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    
    // MARK: - Environment
    
    @Environment(\.openWindow) private var openWindow

    // MARK: - Computed Properties
    
    private var contentSource: ContentSource {
        ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
    }

    /// 当前启用的数据源集合（由用户在 Onboarding/Settings 中控制）
    private var enabledContentSources: [ContentSource] {
        ContentSource.allCases.filter { isSourceEnabled($0) }
    }

    private func isSourceEnabled(_ source: ContentSource) -> Bool {
        switch source {
        case .appleBooks:
            return appleBooksSourceEnabled
        case .goodLinks:
            return goodLinksSourceEnabled
        case .weRead:
            return weReadSourceEnabled
        }
    }

    // MARK: - Body
    
    var body: some View {
        mainContent
            .onAppear {
                // 根据当前启用的数据源初始化滑动容器
                updateDataSourceSwitchViewModel()
                // 注入 WeRead 缓存服务
                if let cacheService = DIContainer.shared.weReadCacheService {
                    weReadVM.setCacheService(cacheService)
                }
                // 同步滑动容器与菜单状态
                syncSwipeViewModelWithContentSource()
            }
            // 当数据源启用状态变化时，更新 DataSourceSwitchViewModel
            .onChange(of: appleBooksSourceEnabled) { _, _ in
                updateDataSourceSwitchViewModel()
            }
            .onChange(of: goodLinksSourceEnabled) { _, _ in
                updateDataSourceSwitchViewModel()
            }
            .onChange(of: weReadSourceEnabled) { _, _ in
                updateDataSourceSwitchViewModel()
            }
            // 当菜单切换时，同步到滑动容器
            .onChange(of: contentSourceRawValue) { _, newValue in
                if let source = ContentSource(rawValue: newValue) {
                    dataSourceSwitchVM.switchTo(source: source)
                }
            }
            // 当滑动切换时，同步到菜单（加 guard 避免无意义写回）
            .onChange(of: dataSourceSwitchVM.currentDataSource) { _, newSource in
                guard let source = newSource else { return }
                if contentSourceRawValue != source.rawValue {
                    contentSourceRawValue = source.rawValue
                }
            }
    }
    
    // MARK: - Private Methods
    
    /// 根据当前的启用数据源列表，更新滑动容器的 ViewModel，并保持与 contentSourceRawValue 一致
    private func updateDataSourceSwitchViewModel() {
        let sources = enabledContentSources
        dataSourceSwitchVM.updateEnabledDataSources(sources)
        
        // 如果当前 contentSource 指向一个已经被禁用的源，让 DataSourceSwitchViewModel 决定新的当前源
        if let current = dataSourceSwitchVM.currentDataSource {
            if contentSourceRawValue != current.rawValue {
                contentSourceRawValue = current.rawValue
            }
        }
    }
    
    private func syncSwipeViewModelWithContentSource() {
        if let source = ContentSource(rawValue: contentSourceRawValue) {
            dataSourceSwitchVM.switchTo(source: source)
        }
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        if enabledContentSources.isEmpty {
            noSourcePlaceholder
        } else {
            NavigationSplitView {
                masterColumn
            } detail: {
                detailColumn
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
            .alert("Notion Configuration Required", isPresented: $appleBooksVM.showNotionConfigAlert) {
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

    private var noSourcePlaceholder: some View {
        VStack(spacing: 16) {
            Image(systemName: "books.vertical")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No data sources enabled")
                .font(.title3)
            Text("Please enable at least one source in Settings.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Button {
                openWindow(id: "setting")
            } label: {
                Label("Open Settings", systemImage: "gearshape")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Master Column (侧边栏)
    
    @ViewBuilder
    private var masterColumn: some View {
        SwipeableDataSourceContainer(
            viewModel: dataSourceSwitchVM,
            appleBooksVM: appleBooksVM,
            goodLinksVM: goodLinksVM,
            weReadVM: weReadVM,
            selectedBookIds: $selectedBookIds,
            selectedLinkIds: $selectedLinkIds,
            selectedWeReadBookIds: $selectedWeReadBookIds,
            filterMenu: { dataSourceToolbarMenu }
        )
        .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
    }
    
    // MARK: - Toolbar Menu
    
    private var dataSourceToolbarMenu: some View {
        Menu {
            // 排序和筛选部分（根据当前数据源显示对应选项）
            switch contentSource {
            case .appleBooks:
                appleBooksFilterMenu
            case .goodLinks:
                goodLinksFilterMenu
            case .weRead:
                weReadFilterMenu
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
        }
        .menuIndicator(.hidden)
    }
    
    // MARK: - Filter Menus
    
    @ViewBuilder
    private var appleBooksFilterMenu: some View {
        Section("Sort") {
            ForEach(BookListSortKey.allCases, id: \.self) { key in
                Button {
                    appleBooksVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("AppleBooksFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if appleBooksVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                appleBooksVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("AppleBooksFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": appleBooksVM.sortAscending]
                )
            } label: {
                if appleBooksVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }

        Section("Filter") {
            Button {
                appleBooksVM.showWithTitleOnly.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("AppleBooksFilterChanged"),
                    object: nil,
                    userInfo: ["showWithTitleOnly": appleBooksVM.showWithTitleOnly]
                )
            } label: {
                if appleBooksVM.showWithTitleOnly {
                    Label("Titles only", systemImage: "checkmark")
                } else {
                    Text("Titles only")
                }
            }
        }
    }
    
    @ViewBuilder
    private var goodLinksFilterMenu: some View {
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
    
    @ViewBuilder
    private var weReadFilterMenu: some View {
        Section("Sort") {
            let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
            ForEach(availableKeys, id: \.self) { key in
                Button {
                    weReadVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("WeReadFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if weReadVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                weReadVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("WeReadFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": weReadVM.sortAscending]
                )
            } label: {
                if weReadVM.sortAscending {
                    Label("Ascending", systemImage: "checkmark")
                } else {
                    Label("Ascending", systemImage: "xmark")
                }
            }
        }
    }

    // MARK: - Detail Column
    
    @ViewBuilder
    private var detailColumn: some View {
        switch contentSource {
        case .appleBooks:
            appleBooksDetailView
        case .goodLinks:
            goodLinksDetailView
        case .weRead:
            weReadDetailView
        }
    }
    
    @ViewBuilder
    private var appleBooksDetailView: some View {
        if selectedBookIds.count == 1 {
            let singleBookBinding = Binding<String?>(
                get: { selectedBookIds.first },
                set: { new in selectedBookIds = new.map { Set([$0]) } ?? [] }
            )
            AppleBooksDetailView(viewModelList: appleBooksVM, selectedBookId: singleBookBinding)
        } else {
            SelectionPlaceholderView(
                title: contentSource.title,
                count: selectedBookIds.isEmpty ? nil : selectedBookIds.count,
                filteredCount: appleBooksVM.displayBooks.count,
                totalCount: appleBooksVM.books.count,
                onSyncSelected: selectedBookIds.isEmpty ? nil : { syncSelectedAppleBooks() }
            )
        }
    }
    
    @ViewBuilder
    private var goodLinksDetailView: some View {
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
                filteredCount: goodLinksVM.displayLinks.count,
                totalCount: goodLinksVM.links.count,
                onSyncSelected: selectedLinkIds.isEmpty ? nil : { syncSelectedGoodLinks() }
            )
        }
    }
    
    @ViewBuilder
    private var weReadDetailView: some View {
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
                filteredCount: weReadVM.displayBooks.count,
                totalCount: weReadVM.books.count,
                onSyncSelected: selectedWeReadBookIds.isEmpty ? nil : { syncSelectedWeRead() }
            )
        }
    }
    
    // MARK: - Sync Methods
    
    private func syncSelectedAppleBooks() {
        let items = selectedBookIds.compactMap { id -> [String: Any]? in
            guard let b = appleBooksVM.displayBooks.first(where: { $0.bookId == id }) else { return nil }
            return ["id": id, "title": b.bookTitle, "subtitle": b.authorName]
        }
        NotificationCenter.default.post(
            name: Notification.Name("SyncTasksEnqueued"),
            object: nil,
            userInfo: ["source": "appleBooks", "items": items]
        )
        appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    private func syncSelectedGoodLinks() {
        let items = selectedLinkIds.compactMap { id -> [String: Any]? in
            guard let link = goodLinksVM.displayLinks.first(where: { $0.id == id }) else { return nil }
            let title = (link.title?.isEmpty == false ? link.title! : link.url)
            return ["id": id, "title": title, "subtitle": link.author ?? ""]
        }
        NotificationCenter.default.post(
            name: Notification.Name("SyncTasksEnqueued"),
            object: nil,
            userInfo: ["source": "goodLinks", "items": items]
        )
        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    private func syncSelectedWeRead() {
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
}

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
