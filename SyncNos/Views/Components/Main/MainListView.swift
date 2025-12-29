import SwiftUI

/// 键盘导航目标：当前焦点在 List 还是 Detail
enum KeyboardNavigationTarget {
    case list
    case detail
}

struct MainListView: View {
    // MARK: - State Objects (internal for extensions)
    
    @StateObject var dataSourceSwitchVM = DataSourceSwitchViewModel()
    @StateObject var appleBooksVM = AppleBooksViewModel()
    @StateObject var goodLinksVM = GoodLinksViewModel()
    @StateObject var weReadVM = WeReadViewModel()
    @StateObject var dedaoVM: DedaoViewModel
    @StateObject var chatsVM = ChatViewModel()
    
    // MARK: - Selection State (internal for extensions)
    
    @State var selectedBookIds: Set<String> = []
    @State var selectedLinkIds: Set<String> = []
    @State var selectedWeReadBookIds: Set<String> = []
    @State var selectedDedaoBookIds: Set<String> = []
    @State var selectedChatsContactIds: Set<String> = []
    
    // MARK: - Chats State (internal for extensions)
    
    @State var showNewConversationAlert: Bool = false
    @State var newConversationName: String = ""
    
    // MARK: - Centralized Alert State
    
    /// 统一的 Notion 配置弹窗状态
    @State private var showNotionConfigAlert: Bool = false
    /// 统一的会话过期弹窗状态
    @State private var showSessionExpiredAlert: Bool = false
    @State private var sessionExpiredSource: ContentSource = .weRead
    @State private var sessionExpiredReason: String = ""
    
    // MARK: - Keyboard Navigation State (internal for extensions)
    
    /// 当前键盘导航目标（List 或 Detail）
    @State var keyboardNavigationTarget: KeyboardNavigationTarget = .list
    /// 当前 Detail 视图的 NSScrollView（用于键盘滚动）
    @State var currentDetailScrollView: NSScrollView?
    /// Detail 侧稳定的 firstResponder “落点”（避免依赖 ScrollView 内部实现细节）
    @State var detailFirstResponderProxyView: NSView?
    /// 保存进入 Detail 前的 firstResponder，用于返回时恢复
    @State var savedMasterFirstResponder: NSResponder?
    /// 当前窗口引用（用于过滤键盘事件）
    @State var mainWindow: NSWindow?
    /// 键盘事件监听器
    @State var keyDownMonitor: Any?
    /// 鼠标点击事件监听器（用于同步焦点状态）
    @State var mouseDownMonitor: Any?
    
    // MARK: - App Storage
    
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    @AppStorage("datasource.dedao.enabled") private var dedaoSourceEnabled: Bool = false
    @AppStorage("datasource.chats.enabled") private var chatsSourceEnabled: Bool = false
    
    // MARK: - Font Scale Support (internal for extensions)
    @ObservedObject var fontScaleManager = FontScaleManager.shared
    
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

    // MARK: - Computed Properties (internal for extensions)
    
    var contentSource: ContentSource {
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
        case .chats:
            return chatsSourceEnabled
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
                // 启动键盘监听（键盘导航）
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
            .onChange(of: chatsSourceEnabled) { _, _ in
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
                    // 鼠标点击左侧时，明确把导航目标切回 List，避免 target 状态滞留导致 ←/→ 行为异常
                    .contentShape(Rectangle())
                    .simultaneousGesture(
                        TapGesture().onEnded {
                            self.keyboardNavigationTarget = .list
                        }
                    )
            } detail: {
                detailColumn
                    // 提供一个稳定可聚焦的 NSView，作为 Detail 抢 firstResponder 的兜底“落点”
                    .background(FirstResponderProxyView(view: $detailFirstResponderProxyView))
                    // 鼠标点击右侧时，明确把导航目标切到 Detail，并抢走 firstResponder（让左侧选中高亮进入非激活态）
                    .contentShape(Rectangle())
                    .simultaneousGesture(
                        TapGesture().onEnded {
                            guard self.hasSingleSelectionForCurrentSource() else { return }
                            guard let window = self.mainWindow else { return }
                            
                            // 避免抢走文本编辑（field editor）的 firstResponder（例如弹窗输入框/搜索框等）
                            if window.firstResponder is NSTextView { return }
                            
                            if self.keyboardNavigationTarget == .list {
                                self.savedMasterFirstResponder = window.firstResponder
                            }
                            
                            self.keyboardNavigationTarget = .detail
                            self.focusDetailScrollViewIfPossible(window: window)
                        }
                    )
            }
            .onChange(of: contentSourceRawValue) { _, _ in
                // 切换数据源时重置选择和焦点状态
                selectedBookIds.removeAll()
                selectedLinkIds.removeAll()
                selectedWeReadBookIds.removeAll()
                selectedDedaoBookIds.removeAll()
                keyboardNavigationTarget = .list
                currentDetailScrollView = nil
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
            // MARK: - Chats New Chat Alert
            .alert("New Chat", isPresented: $showNewConversationAlert) {
                TextField("Contact Name", text: $newConversationName)
                Button("Create") {
                    guard !newConversationName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    let contactId = chatsVM.createConversation(
                        name: newConversationName.trimmingCharacters(in: .whitespaces)
                    )
                    selectedChatsContactIds = [contactId.uuidString]
                    newConversationName = ""
                }
                Button("Cancel", role: .cancel) {
                    newConversationName = ""
                }
            } message: {
                Text("Enter contact name")
            }
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
            chatsVM: chatsVM,
            selectedBookIds: $selectedBookIds,
            selectedLinkIds: $selectedLinkIds,
            selectedWeReadBookIds: $selectedWeReadBookIds,
            selectedDedaoBookIds: $selectedDedaoBookIds,
            selectedChatsContactIds: $selectedChatsContactIds,
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
            case .chats:
                chatsFilterMenu
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
        }
        .menuIndicator(.hidden)
    }
    
}
