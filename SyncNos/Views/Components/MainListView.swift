import SwiftUI
import AppKit

struct MainListView: View {
    // MARK: - State
    
    @StateObject private var dataSourceManager = DataSourceManager()
    @StateObject private var appleBooksVM = AppleBooksViewModel()
    @StateObject private var goodLinksVM = GoodLinksViewModel()
    @StateObject private var weReadVM = WeReadViewModel()
    
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @State private var selectedWeReadBookIds: Set<String> = []
    
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    
    @Environment(\.openWindow) private var openWindow
    
    // MARK: - Computed Properties
    
    /// 当前选择的 ID 集合（根据活动数据源）
    private var currentSelectionIds: Binding<Set<String>> {
        switch dataSourceManager.currentType {
        case .appleBooks:
            return $selectedBookIds
        case .goodLinks:
            return $selectedLinkIds
        case .weRead:
            return $selectedWeReadBookIds
        case .none:
            return .constant([])
        }
    }
    
    // MARK: - Body
    
    var body: some View {
        mainContent
            .onAppear {
                setupOnAppear()
            }
            .onChange(of: appleBooksSourceEnabled) { _, _ in
                dataSourceManager.refreshDataSources()
            }
            .onChange(of: goodLinksSourceEnabled) { _, _ in
                dataSourceManager.refreshDataSources()
            }
            .onChange(of: weReadSourceEnabled) { _, _ in
                dataSourceManager.refreshDataSources()
            }
    }
    
    // MARK: - Main Content
    
    @ViewBuilder
    private var mainContent: some View {
        if !dataSourceManager.hasEnabledSources {
            noSourcePlaceholder
        } else {
            NavigationSplitView {
                masterColumn
            } detail: {
                detailColumn
            }
            .onChange(of: dataSourceManager.currentType) { _, _ in
                clearAllSelections()
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncQueueTaskSelected")).receive(on: DispatchQueue.main)) { notification in
                handleSyncQueueTaskSelected(notification)
            }
            .background {
                backgroundGradient
            }
            .toolbarBackground(.hidden, for: .windowToolbar)
            .alert("Notion Configuration Required", isPresented: $appleBooksVM.showNotionConfigAlert) {
                notionConfigAlertButtons
            } message: {
                Text("Please configure Notion API Key and Page ID before syncing.")
            }
            .alert("Notion Configuration Required", isPresented: $goodLinksVM.showNotionConfigAlert) {
                notionConfigAlertButtons
            } message: {
                Text("Please configure Notion API Key and Page ID before syncing.")
            }
        }
    }
    
    // MARK: - Master Column (侧边栏)
    
    @ViewBuilder
    private var masterColumn: some View {
        SwipeableSidebarView(
            dataSourceManager: dataSourceManager,
            selectionIds: currentSelectionIds
        ) { type in
            dataSourceContent(for: type)
        }
        .navigationSplitViewColumnWidth(min: 220, ideal: 320, max: 400)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                dataSourceToolbarMenu
            }
        }
    }
    
    /// 根据数据源类型返回对应的内容视图
    @ViewBuilder
    private func dataSourceContent(for type: DataSourceType) -> some View {
        switch type {
        case .appleBooks:
            AppleBooksListView(viewModel: appleBooksVM, selectionIds: $selectedBookIds)
        case .goodLinks:
            GoodLinksListView(viewModel: goodLinksVM, selectionIds: $selectedLinkIds)
        case .weRead:
            WeReadListView(viewModel: weReadVM, selectionIds: $selectedWeReadBookIds)
        }
    }
    
    // MARK: - Detail Column
    
    @ViewBuilder
    private var detailColumn: some View {
        switch dataSourceManager.currentType {
        case .appleBooks:
            appleBooksDetailView
        case .goodLinks:
            goodLinksDetailView
        case .weRead:
            weReadDetailView
        case .none:
            SelectionPlaceholderView(title: "No Source", count: nil, onSyncSelected: nil)
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
                title: DataSourceType.appleBooks.title,
                count: selectedBookIds.isEmpty ? nil : selectedBookIds.count,
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
                title: DataSourceType.goodLinks.title,
                count: selectedLinkIds.isEmpty ? nil : selectedLinkIds.count,
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
                title: DataSourceType.weRead.title,
                count: selectedWeReadBookIds.isEmpty ? nil : selectedWeReadBookIds.count,
                onSyncSelected: selectedWeReadBookIds.isEmpty ? nil : { syncSelectedWeRead() }
            )
        }
    }
    
    // MARK: - Toolbar Menu
    
    private var dataSourceToolbarMenu: some View {
        Menu {
            // 数据源切换部分
            Section("Data Source") {
                ForEach(dataSourceManager.enabledDataSources) { source in
                    Button {
                        dataSourceManager.setActiveDataSource(source)
                    } label: {
                        HStack {
                            Text(menuTitle(for: source.type))
                            if dataSourceManager.currentDataSource?.id == source.id {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            
            // 排序和筛选部分
            if let currentType = dataSourceManager.currentType {
                Divider()
                sortAndFilterMenu(for: currentType)
            }
        } label: {
            Text(dataSourceManager.currentDataSource?.name ?? "Select Source")
        }
    }
    
    private func menuTitle(for type: DataSourceType) -> String {
        switch type {
        case .appleBooks:
            return "Apple Books (\(appleBooksVM.displayBooks.count)/\(appleBooksVM.books.count))"
        case .goodLinks:
            return "GoodLinks (\(goodLinksVM.displayLinks.count)/\(goodLinksVM.links.count))"
        case .weRead:
            return "WeRead (\(weReadVM.displayBooks.count)/\(weReadVM.books.count))"
        }
    }
    
    @ViewBuilder
    private func sortAndFilterMenu(for type: DataSourceType) -> some View {
        switch type {
        case .appleBooks:
            appleBooksFilterMenu
        case .goodLinks:
            goodLinksFilterMenu
        case .weRead:
            weReadFilterMenu
        }
    }
    
    private var appleBooksFilterMenu: some View {
        Group {
            Section("Sort") {
                ForEach(BookListSortKey.allCases, id: \.self) { key in
                    Button {
                        appleBooksVM.sortKey = key
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
                } label: {
                    if appleBooksVM.showWithTitleOnly {
                        Label("Titles only", systemImage: "checkmark")
                    } else {
                        Text("Titles only")
                    }
                }
            }
        }
    }
    
    private var goodLinksFilterMenu: some View {
        Group {
            Section("Sort") {
                ForEach(GoodLinksSortKey.allCases, id: \.self) { key in
                    Button {
                        goodLinksVM.sortKey = key
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
                } label: {
                    if goodLinksVM.showStarredOnly {
                        Label("Starred only", systemImage: "checkmark")
                    } else {
                        Text("Starred only")
                    }
                }
            }
        }
    }
    
    private var weReadFilterMenu: some View {
        Group {
            Section("Sort") {
                let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
                ForEach(availableKeys, id: \.self) { key in
                    Button {
                        weReadVM.sortKey = key
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
                } label: {
                    if weReadVM.sortAscending {
                        Label("Ascending", systemImage: "checkmark")
                    } else {
                        Label("Ascending", systemImage: "xmark")
                    }
                }
            }
        }
    }
    
    // MARK: - Supporting Views
    
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
    
    private var backgroundGradient: some View {
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
    
    private var notionConfigAlertButtons: some View {
        Group {
            Button("Go to Settings") {
                openWindow(id: "setting")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    NotificationCenter.default.post(name: Notification.Name("NavigateToNotionSettings"), object: nil)
                }
            }
            Button("Cancel", role: .cancel) { }
        }
    }
    
    // MARK: - Private Methods
    
    private func setupOnAppear() {
        // 注入 WeRead 缓存服务
        if let cacheService = DIContainer.shared.weReadCacheService {
            weReadVM.setCacheService(cacheService)
        }
    }
    
    private func clearAllSelections() {
        selectedBookIds.removeAll()
        selectedLinkIds.removeAll()
        selectedWeReadBookIds.removeAll()
    }
    
    private func handleSyncQueueTaskSelected(_ notification: Notification) {
        guard let info = notification.userInfo as? [String: Any],
              let source = info["source"] as? String,
              let id = info["id"] as? String else { return }
        
        if source == DataSourceType.appleBooks.rawValue {
            if let appleBooks = dataSourceManager.dataSource(for: .appleBooks) {
                dataSourceManager.setActiveDataSource(appleBooks)
            }
            selectedLinkIds.removeAll()
            selectedWeReadBookIds.removeAll()
            selectedBookIds = Set([id])
        } else if source == DataSourceType.goodLinks.rawValue {
            if let goodLinks = dataSourceManager.dataSource(for: .goodLinks) {
                dataSourceManager.setActiveDataSource(goodLinks)
            }
            selectedBookIds.removeAll()
            selectedWeReadBookIds.removeAll()
            selectedLinkIds = Set([id])
        } else if source == DataSourceType.weRead.rawValue {
            if let weRead = dataSourceManager.dataSource(for: .weRead) {
                dataSourceManager.setActiveDataSource(weRead)
            }
            selectedBookIds.removeAll()
            selectedLinkIds.removeAll()
            selectedWeReadBookIds = Set([id])
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

// MARK: - Preview

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
