import SwiftUI
import AppKit

struct MainListView: View {
    // MARK: - State Objects
    
    @StateObject private var dataSourceSwitchVM = DataSourceSwitchViewModel()
    @StateObject private var appleBooksVM = AppleBooksViewModel()
    @StateObject private var goodLinksVM = GoodLinksViewModel()
    @StateObject private var weReadVM = WeReadViewModel()
    @StateObject private var dedaoVM: DedaoViewModel
    
    // MARK: - Selection State
    
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @State private var selectedWeReadBookIds: Set<String> = []
    @State private var selectedDedaoBookIds: Set<String> = []
    
    // MARK: - Centralized Alert State
    
    /// 统一的 Notion 配置弹窗状态
    @State private var showNotionConfigAlert: Bool = false
    /// 统一的会话过期弹窗状态
    @State private var showSessionExpiredAlert: Bool = false
    @State private var sessionExpiredSource: ContentSource = .weRead
    @State private var sessionExpiredReason: String = ""
    
    // MARK: - App Storage
    
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    @AppStorage("datasource.dedao.enabled") private var dedaoSourceEnabled: Bool = false
    
    // MARK: - Initialization
    
    init() {
        _dedaoVM = StateObject(wrappedValue: DedaoViewModel(
            authService: DIContainer.shared.dedaoAuthService,
            apiService: DIContainer.shared.dedaoAPIService,
            cacheService: DIContainer.shared.dedaoCacheService
        ))
    }
    
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
        case .dedao:
            return dedaoSourceEnabled
        }
    }

    // MARK: - Body
    
    var body: some View {
        mainContent
            .onAppear {
                // 根据当前启用的数据源初始化滑动容器
                updateDataSourceSwitchViewModel()
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
            .onChange(of: dedaoSourceEnabled) { _, _ in
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
                selectedDedaoBookIds.removeAll()
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncQueueTaskSelected")).receive(on: DispatchQueue.main)) { n in
                guard let info = n.userInfo as? [String: Any], let source = info["source"] as? String, let id = info["id"] as? String else { return }
                if source == ContentSource.appleBooks.rawValue {
                    contentSourceRawValue = ContentSource.appleBooks.rawValue
                    selectedLinkIds.removeAll()
                    selectedWeReadBookIds.removeAll()
                    selectedDedaoBookIds.removeAll()
                    selectedBookIds = Set([id])
                } else if source == ContentSource.goodLinks.rawValue {
                    contentSourceRawValue = ContentSource.goodLinks.rawValue
                    selectedBookIds.removeAll()
                    selectedWeReadBookIds.removeAll()
                    selectedDedaoBookIds.removeAll()
                    selectedLinkIds = Set([id])
                } else if source == ContentSource.weRead.rawValue {
                    contentSourceRawValue = ContentSource.weRead.rawValue
                    selectedBookIds.removeAll()
                    selectedLinkIds.removeAll()
                    selectedDedaoBookIds.removeAll()
                    selectedWeReadBookIds = Set([id])
                } else if source == ContentSource.dedao.rawValue {
                    contentSourceRawValue = ContentSource.dedao.rawValue
                    selectedBookIds.removeAll()
                    selectedLinkIds.removeAll()
                    selectedWeReadBookIds.removeAll()
                    selectedDedaoBookIds = Set([id])
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
            // MARK: - Centralized Alerts
            // 统一的 Notion 配置弹窗
            .alert("Notion Configuration Required", isPresented: $showNotionConfigAlert) {
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
            // 统一的会话过期弹窗（WeRead/Dedao）
            .alert(
                sessionExpiredSource == .weRead
                    ? NSLocalizedString("Session Expired", comment: "")
                    : String(localized: "Session Expired"),
                isPresented: $showSessionExpiredAlert
            ) {
                Button(NSLocalizedString("Remind Me Later", comment: ""), role: .cancel) { }
                Button(NSLocalizedString("Go to Login", comment: "")) {
                    navigateToLogin(for: sessionExpiredSource)
                }
            } message: {
                Text(sessionExpiredReason)
            }
            // MARK: - Centralized Notification Listeners
            // 监听 Notion 配置弹窗通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShowNotionConfigAlert")).receive(on: DispatchQueue.main)) { _ in
                showNotionConfigAlert = true
            }
            // 监听会话过期弹窗通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShowSessionExpiredAlert")).receive(on: DispatchQueue.main)) { notification in
                if let userInfo = notification.userInfo,
                   let sourceRaw = userInfo["source"] as? String,
                   let source = ContentSource(rawValue: sourceRaw),
                   let reason = userInfo["reason"] as? String {
                    sessionExpiredSource = source
                    sessionExpiredReason = reason
                    showSessionExpiredAlert = true
                }
            }
            // 监听同步选中项通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("SyncSelectedToNotionRequested")).receive(on: DispatchQueue.main)) { _ in
                syncSelectedForCurrentSource()
            }
            // 监听刷新请求通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
                refreshCurrentSource()
            }
        }
    }
    
    // MARK: - Centralized Navigation
    
    private func navigateToLogin(for source: ContentSource) {
        switch source {
        case .weRead:
            weReadVM.navigateToWeReadLogin()
        case .dedao:
            dedaoVM.navigateToDedaoLogin()
        default:
            break
        }
    }
    
    // MARK: - Centralized Sync & Refresh
    
    private func syncSelectedForCurrentSource() {
        switch contentSource {
        case .appleBooks:
            appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .goodLinks:
            goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .weRead:
            weReadVM.batchSync(bookIds: selectedWeReadBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .dedao:
            dedaoVM.batchSync(bookIds: selectedDedaoBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        }
    }
    
    private func refreshCurrentSource() {
        Task {
            switch contentSource {
            case .appleBooks:
                await appleBooksVM.loadBooks()
            case .goodLinks:
                await goodLinksVM.loadRecentLinks()
            case .weRead:
                await weReadVM.loadBooks()
            case .dedao:
                await dedaoVM.loadBooks()
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
            dedaoVM: dedaoVM,
            selectedBookIds: $selectedBookIds,
            selectedLinkIds: $selectedLinkIds,
            selectedWeReadBookIds: $selectedWeReadBookIds,
            selectedDedaoBookIds: $selectedDedaoBookIds,
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
            case .dedao:
                dedaoFilterMenu
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
    
    @ViewBuilder
    private var dedaoFilterMenu: some View {
        Section("Sort") {
            let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
            ForEach(availableKeys, id: \.self) { key in
                Button {
                    dedaoVM.sortKey = key
                    NotificationCenter.default.post(
                        name: Notification.Name("DedaoFilterChanged"),
                        object: nil,
                        userInfo: ["sortKey": key.rawValue]
                    )
                } label: {
                    if dedaoVM.sortKey == key {
                        Label(key.displayName, systemImage: "checkmark")
                    } else {
                        Text(key.displayName)
                    }
                }
            }

            Divider()

            Button {
                dedaoVM.sortAscending.toggle()
                NotificationCenter.default.post(
                    name: Notification.Name("DedaoFilterChanged"),
                    object: nil,
                    userInfo: ["sortAscending": dedaoVM.sortAscending]
                )
            } label: {
                if dedaoVM.sortAscending {
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
        case .dedao:
            dedaoDetailView
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
    
    @ViewBuilder
    private var dedaoDetailView: some View {
        if selectedDedaoBookIds.count == 1 {
            let singleDedaoBookBinding = Binding<String?>(
                get: { selectedDedaoBookIds.first },
                set: { new in selectedDedaoBookIds = new.map { Set([$0]) } ?? [] }
            )
            DedaoDetailView(listViewModel: dedaoVM, selectedBookId: singleDedaoBookBinding)
        } else {
            SelectionPlaceholderView(
                title: contentSource.title,
                count: selectedDedaoBookIds.isEmpty ? nil : selectedDedaoBookIds.count,
                filteredCount: dedaoVM.displayBooks.count,
                totalCount: dedaoVM.books.count,
                onSyncSelected: selectedDedaoBookIds.isEmpty ? nil : { syncSelectedDedao() }
            )
        }
    }
    
    // MARK: - Sync Methods
    // 注意：SyncTasksEnqueued 通知由各 ViewModel 的 batchSync() 方法统一发送，
    // 此处不应重复发送，遵循唯一入口原则。
    
    private func syncSelectedAppleBooks() {
        appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    private func syncSelectedGoodLinks() {
        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    private func syncSelectedWeRead() {
        weReadVM.batchSync(bookIds: selectedWeReadBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    private func syncSelectedDedao() {
        dedaoVM.batchSync(bookIds: selectedDedaoBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
}

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
