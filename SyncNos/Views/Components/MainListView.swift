import SwiftUI
import AppKit

/// 键盘导航目标：当前焦点在 List 还是 Detail
private enum KeyboardNavigationTarget {
    case list
    case detail
}

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
    
    // MARK: - Keyboard Navigation State
    
    /// 当前键盘导航目标（List 或 Detail）
    @State private var keyboardNavigationTarget: KeyboardNavigationTarget = .list
    /// 当前 Detail 视图的 NSScrollView（用于键盘滚动）
    @State private var currentDetailScrollView: NSScrollView?
    /// 保存进入 Detail 前的 firstResponder，用于返回时恢复
    @State private var savedMasterFirstResponder: NSResponder?
    /// 当前窗口引用（用于过滤键盘事件）
    @State private var mainWindow: NSWindow?
    /// 键盘事件监听器
    @State private var keyDownMonitor: Any?
    
    // MARK: - App Storage
    
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    @AppStorage("datasource.dedao.enabled") private var dedaoSourceEnabled: Bool = false
    
    // MARK: - Font Scale Support
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
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

    /// 当前启用的数据源集合（按用户自定义顺序排列）
    private var enabledContentSources: [ContentSource] {
        ContentSource.orderedEnabledSources(isEnabled: isSourceEnabled)
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
            .background(WindowReader(window: $mainWindow))
            .onAppear {
                // 根据当前启用的数据源初始化滑动容器
                updateDataSourceSwitchViewModel()
                // 同步滑动容器与菜单状态
                syncSwipeViewModelWithContentSource()
                // 启动键盘监听
                startKeyboardMonitorIfNeeded()
            }
            .onDisappear {
                stopKeyboardMonitorIfNeeded()
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
            // 注意：数据源顺序变化（拖拽排序）由 DataSourceIndicatorBar 直接更新 ViewModel，
            // 不需要在这里监听 orderChangedNotification，避免重复更新
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
            // 监听完整重新同步通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("FullResyncSelectedRequested")).receive(on: DispatchQueue.main)) { _ in
                fullResyncSelectedForCurrentSource()
            }
            // 监听刷新请求通知
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
                refreshCurrentSource()
            }
        }
    }
    
    // MARK: - Keyboard Monitor
    
    private func startKeyboardMonitorIfNeeded() {
        guard keyDownMonitor == nil else { return }
        
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // 只处理 MainListView 所在窗口的事件，避免影响 Settings 等其它窗口
            guard let window = self.mainWindow, event.window === window else {
                return event
            }
            
            // 不拦截带 Command/Option/Control 的组合键（例如 Cmd+←/→ 已用于切换数据源）
            let modifiers = event.modifierFlags
            if modifiers.contains(.command) || modifiers.contains(.option) || modifiers.contains(.control) {
                return event
            }
            
            switch event.keyCode {
            case 123: // ←
                if self.keyboardNavigationTarget == .detail {
                    self.keyboardNavigationTarget = .list
                    self.focusBackToMaster(window: window)
                    return nil
                }
                return event
            case 124: // →
                if self.keyboardNavigationTarget == .list, self.hasSingleSelectionForCurrentSource() {
                    // 保存进入 Detail 前的真实焦点（通常是当前 List），用于返回时恢复
                    self.savedMasterFirstResponder = window.firstResponder
                    self.keyboardNavigationTarget = .detail
                    self.focusDetailScrollViewIfPossible(window: window)
                    return nil
                }
                return event
            case 126: // ↑
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetail(byLines: -1)
                    return nil
                }
                return event
            case 125: // ↓
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetail(byLines: 1)
                    return nil
                }
                return event
            case 115: // Home (Fn+←)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToTop()
                    return nil
                }
                return event
            case 119: // End (Fn+→)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToBottom()
                    return nil
                }
                return event
            case 116: // Page Up (Fn+↑)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailByPage(up: true)
                    return nil
                }
                return event
            case 121: // Page Down (Fn+↓)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailByPage(up: false)
                    return nil
                }
                return event
            default:
                return event
            }
        }
    }
    
    private func stopKeyboardMonitorIfNeeded() {
        if let monitor = keyDownMonitor {
            NSEvent.removeMonitor(monitor)
            keyDownMonitor = nil
        }
    }
    
    private func hasSingleSelectionForCurrentSource() -> Bool {
        switch contentSource {
        case .appleBooks:
            return selectedBookIds.count == 1
        case .goodLinks:
            return selectedLinkIds.count == 1
        case .weRead:
            return selectedWeReadBookIds.count == 1
        case .dedao:
            return selectedDedaoBookIds.count == 1
        }
    }
    
    private func scrollCurrentDetail(byLines lines: Int) {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        // 基于 "一行" 的滚动步长（同时考虑动态字体缩放）
        let baseStep: CGFloat = 56
        let step = baseStep * fontScaleManager.scaleFactor
        let delta = CGFloat(lines) * step
        
        // flipped 坐标系下，y 增大表示向下
        let effectiveDelta = (documentView.isFlipped ? delta : -delta)
        
        let clipView = scrollView.contentView
        var newOrigin = clipView.bounds.origin
        newOrigin.y += effectiveDelta
        
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        newOrigin.y = min(max(newOrigin.y, 0), maxY)
        
        clipView.scroll(to: newOrigin)
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 滚动到顶部 (Home)
    private func scrollCurrentDetailToTop() {
        guard let scrollView = currentDetailScrollView else { return }
        let clipView = scrollView.contentView
        clipView.scroll(to: NSPoint(x: 0, y: 0))
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 滚动到底部 (End)
    private func scrollCurrentDetailToBottom() {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        let clipView = scrollView.contentView
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        clipView.scroll(to: NSPoint(x: 0, y: maxY))
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 按页滚动 (Page Up / Page Down)
    private func scrollCurrentDetailByPage(up: Bool) {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        let clipView = scrollView.contentView
        // 页滚动量为可见区域高度的 90%，留一点重叠便于阅读连贯
        let pageHeight = clipView.bounds.height * 0.9
        let delta = up ? -pageHeight : pageHeight
        
        // flipped 坐标系下，y 增大表示向下
        let effectiveDelta = (documentView.isFlipped ? delta : -delta)
        
        var newOrigin = clipView.bounds.origin
        newOrigin.y += effectiveDelta
        
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        newOrigin.y = min(max(newOrigin.y, 0), maxY)
        
        clipView.scroll(to: newOrigin)
        scrollView.reflectScrolledClipView(clipView)
    }
    
    // MARK: - Focus Helpers
    
    private func focusDetailScrollViewIfPossible(window: NSWindow) {
        guard let scrollView = currentDetailScrollView else { return }
        DispatchQueue.main.async {
            // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
            _ = window.makeFirstResponder(scrollView.contentView)
        }
    }
    
    private func focusBackToMaster(window: NSWindow) {
        let responder = savedMasterFirstResponder
        DispatchQueue.main.async {
            if let responder, window.makeFirstResponder(responder) {
                return
            }
            // 兜底：触发当前数据源 List 再次请求焦点（保留现有机制，避免焦点丢失导致 ↑↓ 不再选中 List）
            NotificationCenter.default.post(name: self.focusNotificationName(for: self.contentSource), object: nil)
        }
    }
    
    private func focusNotificationName(for source: ContentSource) -> Notification.Name {
        switch source {
        case .appleBooks:
            return Notification.Name("DataSourceSwitchedToAppleBooks")
        case .goodLinks:
            return Notification.Name("DataSourceSwitchedToGoodLinks")
        case .weRead:
            return Notification.Name("DataSourceSwitchedToWeRead")
        case .dedao:
            return Notification.Name("DataSourceSwitchedToDedao")
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
    
    /// 完整重新同步：清除本地 UUID 记录，然后触发同步
    private func fullResyncSelectedForCurrentSource() {
        let syncedHighlightStore = DIContainer.shared.syncedHighlightStore
        let logger = DIContainer.shared.loggerService
        
        Task {
            // 根据当前数据源获取选中的 ID、书名和 sourceKey
            let sourceKey: String
            let selectedItems: [(id: String, title: String)]
            
            switch contentSource {
            case .appleBooks:
                sourceKey = "appleBooks"
                selectedItems = selectedBookIds.compactMap { id in
                    if let book = appleBooksVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.bookTitle)
                    }
                    return nil
                }
            case .goodLinks:
                sourceKey = "goodLinks"
                selectedItems = selectedLinkIds.compactMap { id in
                    if let link = goodLinksVM.links.first(where: { $0.id == id }) {
                        return (id: id, title: link.title ?? "Unknown")
                    }
                    return nil
                }
            case .weRead:
                sourceKey = "weRead"
                selectedItems = selectedWeReadBookIds.compactMap { id in
                    if let book = weReadVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            case .dedao:
                sourceKey = "dedao"
                selectedItems = selectedDedaoBookIds.compactMap { id in
                    if let book = dedaoVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            }
            
            // 清除每个选中项的本地记录
            for item in selectedItems {
                do {
                    try await syncedHighlightStore.clearRecords(sourceKey: sourceKey, bookId: item.id)
                    logger.info("[FullResync] Cleared local records for \"\(item.title)\"")
                } catch {
                    logger.error("[FullResync] Failed to clear records for \"\(item.title)\": \(error.localizedDescription)")
                }
            }
            
            // 触发同步（现在会从 Notion 重新获取）
            await MainActor.run {
                syncSelectedForCurrentSource()
            }
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
                .font(.system(size: 40 * fontScaleManager.scaleFactor))
                .foregroundStyle(.secondary)
            Text("No data sources enabled")
                .scaledFont(.title3)
            Text("Please enable at least one source in Settings.")
                .scaledFont(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Button {
                openWindow(id: "setting")
            } label: {
                Label("Open Settings", systemImage: "gearshape")
            }
            .scaledFont(.body)
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
            AppleBooksDetailView(
                viewModelList: appleBooksVM,
                selectedBookId: singleBookBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
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
            GoodLinksDetailView(
                viewModel: goodLinksVM,
                selectedLinkId: singleLinkBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
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
            WeReadDetailView(
                listViewModel: weReadVM,
                selectedBookId: singleWeReadBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
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
            DedaoDetailView(
                listViewModel: dedaoVM,
                selectedBookId: singleDedaoBookBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedDedaoBookIds.isEmpty ? nil : selectedDedaoBookIds.count,
                filteredCount: dedaoVM.displayBooks.count,
                totalCount: dedaoVM.books.count,
                onSyncSelected: selectedDedaoBookIds.isEmpty ? nil : { syncSelectedDedao() }
            )
        }
    }
    
    // MARK: - Sync Methods
    // 注意：任务入队由各 ViewModel 的 batchSync() 方法通过 SyncQueueStore.enqueue() 统一处理，
    // 此处不应直接操作 SyncQueueStore，遵循唯一入口原则。
    
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
