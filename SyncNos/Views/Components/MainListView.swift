import SwiftUI
import AppKit

struct MainListView: View {
    @StateObject private var viewModel = AppleBooksViewModel()
    @State private var selectedBookIds: Set<String> = []
    @State private var selectedLinkIds: Set<String> = []
    @State private var selectedWeReadBookIds: Set<String> = []
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    @Environment(\.openWindow) private var openWindow
    @State private var iapPresentationMode: IAPPresentationMode? = nil

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

    /// 确保 contentSourceRawValue 始终指向一个已启用的数据源（如果存在）
    private func ensureValidContentSource() {
        let available = enabledContentSources
        // 如果全部数据源都被关闭，则保留当前值，让上层占位视图处理
        guard !available.isEmpty else { return }

        let current = ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
        if !isSourceEnabled(current), let first = available.first {
            contentSourceRawValue = first.rawValue
        }
    }

    @StateObject private var goodLinksVM = GoodLinksViewModel()
    @StateObject private var weReadVM = WeReadViewModel()

    private var iapService: IAPServiceProtocol {
        DIContainer.shared.iapService
    }

    var body: some View {
        ZStack {
            if let mode = iapPresentationMode {
                PayWallView(
                    presentationMode: mode,
                    onFinish: {
                        // 用户完成欢迎页、提醒或购买成功后，恢复主界面
                        iapPresentationMode = nil
                        checkTrialStatus()
                    }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                mainContent
                    .transition(.opacity)
            }
        }
        .animation(.spring(), value: iapPresentationMode != nil)
        .onAppear {
            checkTrialStatus()
            // 启动时根据当前启用数据源校正 contentSource
            ensureValidContentSource()
            // 注入 WeRead 缓存服务
            if let cacheService = DIContainer.shared.weReadCacheService {
                weReadVM.setCacheService(cacheService)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: IAPService.statusChangedNotification)) { _ in
            let logger = DIContainer.shared.loggerService
            logger.debug("IAP status changed notification received, rechecking trial status")
            checkTrialStatus()
        }
        // 当数据源启用状态变化时，确保当前内容源仍然有效
        .onChange(of: appleBooksSourceEnabled) { _, _ in
            ensureValidContentSource()
        }
        .onChange(of: goodLinksSourceEnabled) { _, _ in
            ensureValidContentSource()
        }
        .onChange(of: weReadSourceEnabled) { _, _ in
            ensureValidContentSource()
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
                // 避免切换到已被关闭的数据源
                ensureValidContentSource()
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

    @ViewBuilder
    private var masterColumn: some View {
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
                        if isSourceEnabled(.appleBooks) {
                            Button {
                                contentSourceRawValue = ContentSource.appleBooks.rawValue
                            } label: {
                                HStack {
                                    Text("Apple Books (\(viewModel.displayBooks.count)/\(viewModel.books.count))")
                                    if contentSource == .appleBooks { Image(systemName: "checkmark") }
                                }
                            }
                        }

                        if isSourceEnabled(.goodLinks) {
                            Button {
                                contentSourceRawValue = ContentSource.goodLinks.rawValue
                            } label: {
                                HStack {
                                    Text("GoodLinks (\(goodLinksVM.displayLinks.count)/\(goodLinksVM.links.count))")
                                    if contentSource == .goodLinks { Image(systemName: "checkmark") }
                                }
                            }
                        }

                        if isSourceEnabled(.weRead) {
                            Button {
                                contentSourceRawValue = ContentSource.weRead.rawValue
                            } label: {
                                HStack {
                                    Text("WeRead (\(weReadVM.displayBooks.count)/\(weReadVM.books.count))")
                                    if contentSource == .weRead { Image(systemName: "checkmark") }
                                }
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
                    } else if contentSource == .weRead {
                        Divider()

                        Section("Sort") {
                            // WeRead 只支持 title, highlightCount, lastSync
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
                } label: {
                    // 显示数据源名称而不是图标
                    Text(contentSource.title)
                }
            }
        }
    }

    @ViewBuilder
    private var detailColumn: some View {
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

    private func checkTrialStatus() {
        let logger = DIContainer.shared.loggerService
        logger.debug("checkTrialStatus called: hasPurchased=\(iapService.hasPurchased), hasEverPurchasedAnnual=\(iapService.hasEverPurchasedAnnual), isProUnlocked=\(iapService.isProUnlocked), hasShownWelcome=\(iapService.hasShownWelcome), trialDaysRemaining=\(iapService.trialDaysRemaining)")
        
        // Priority 1: 如果已购买，不显示任何付费墙
        if iapService.hasPurchased {
            logger.debug("User has purchased, hiding paywall")
            iapPresentationMode = nil
            return
        }
        
        // Priority 2: 如果曾经购买过年订阅但已过期，显示订阅过期视图
        if iapService.hasEverPurchasedAnnual && !iapService.hasPurchased {
            logger.debug("Annual subscription expired, showing subscriptionExpired view")
            iapPresentationMode = .subscriptionExpired
            return
        }
        
        // Priority 3: 如果试用期过期且从未购买，显示试用期过期视图
        if !iapService.isProUnlocked {
            logger.debug("Trial expired, showing trialExpired view")
            iapPresentationMode = .trialExpired
            return
        }
        
        // Priority 4: 如果应该显示试用提醒，显示提醒视图
        if iapService.shouldShowTrialReminder() {
            logger.debug("Should show trial reminder, showing trialReminder view")
            iapPresentationMode = .trialReminder(daysRemaining: iapService.trialDaysRemaining)
            return
        }
        
        // Note: .welcome 模式已移至 Onboarding 流程中的第四步 (OnboardingTrialView)
        // 用户完成 Onboarding 后，hasShownWelcome 已被标记为 true
        
        // 其他情况不显示付费墙
        logger.debug("No paywall needed, hiding")
        iapPresentationMode = nil
    }
}

struct MainListView_Previews: PreviewProvider {
    static var previews: some View {
        MainListView()
    }
}
