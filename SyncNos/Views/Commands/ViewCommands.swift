import SwiftUI

// MARK: - View Commands
struct ViewCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    /// 数据源自定义顺序（V2：String/RawRepresentable）
    /// 破坏性：不读取旧 Data(JSON) 顺序；首次升级会回退默认顺序，需用户重新拖拽一次
    @AppStorage(ContentSource.orderKey) private var dataSourceOrder: ContentSourceOrder = .default
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
    @AppStorage("datasource.dedao.enabled") private var dedaoSourceEnabled: Bool = false
    @AppStorage("datasource.chats.enabled") private var chatsSourceEnabled: Bool = false
    @AppStorage("bookList_sort_key") private var bookListSortKey: String = BookListSortKey.title.rawValue
    @AppStorage("bookList_sort_ascending") private var bookListSortAscending: Bool = true
    @AppStorage("bookList_showWithTitleOnly") private var bookListShowWithTitleOnly: Bool = false
    @AppStorage("goodlinks_sort_key") private var goodlinksSortKey: String = GoodLinksSortKey.modified.rawValue
    @AppStorage("goodlinks_sort_ascending") private var goodlinksSortAscending: Bool = false
    @AppStorage("goodlinks_show_starred_only") private var goodlinksShowStarredOnly: Bool = false
    @AppStorage("highlight_sort_field") private var highlightSortField: String = HighlightSortField.created.rawValue
    @AppStorage("highlight_sort_ascending") private var highlightSortAscending: Bool = false
    @AppStorage("highlight_has_notes") private var highlightHasNotes: Bool = false
    @AppStorage("highlight_selected_mask") private var highlightSelectedMask: Int = 0

    /// 当前有效的数据源（如果存储值已被用户在设置中关闭，则回退到第一个启用的数据源）
    private var currentSource: ContentSource {
        let stored = ContentSource(rawValue: contentSourceRawValue) ?? .appleBooks
        let enabled = enabledContentSources
        if !isDataSourceEnabled(stored), let first = enabled.first {
            return first
        }
        return stored
    }

    private var enabledContentSources: [ContentSource] {
        dataSourceOrder.sources.filter { isDataSourceEnabled($0) }
    }

    private func isDataSourceEnabled(_ source: ContentSource) -> Bool {
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

    /// 在当前启用的数据源列表中查找指定 source 的索引（0 表示第一个、1 表示第二个、2 表示第三个）
    private func indexForSource(_ source: ContentSource) -> Int? {
        enabledContentSources.firstIndex(of: source)
    }

    /// 根据索引返回对应的快捷键（cmd+1 到 cmd+9）
    private func shortcutKey(for index: Int) -> KeyEquivalent? {
        let value = index + 1
        guard (1...9).contains(value) else { return nil }
        return KeyEquivalent(Character(String(value)))
    }

    // MARK: - Data Source Navigation (Circular)

    /// 当前数据源在启用列表中的索引
    private var currentSourceIndex: Int? {
        indexForSource(currentSource)
    }

    /// 是否可以切换数据源（需要至少 2 个启用的数据源）
    private var canSwitchDataSource: Bool {
        enabledContentSources.count > 1
    }

    /// 切换到上一个数据源（循环）
    private func switchToPreviousDataSource() {
        guard let index = currentSourceIndex, enabledContentSources.count > 1 else { return }
        // 循环：如果是第一个，则切换到最后一个
        let previousIndex = index > 0 ? index - 1 : enabledContentSources.count - 1
        let previousSource = enabledContentSources[previousIndex]
        contentSourceRawValue = previousSource.rawValue
        // 通知由 DataSourceSwitchViewModel.switchTo() 统一发送
    }

    /// 切换到下一个数据源（循环）
    private func switchToNextDataSource() {
        guard let index = currentSourceIndex, enabledContentSources.count > 1 else { return }
        // 循环：如果是最后一个，则切换到第一个
        let nextIndex = (index + 1) % enabledContentSources.count
        let nextSource = enabledContentSources[nextIndex]
        contentSourceRawValue = nextSource.rawValue
        // 通知由 DataSourceSwitchViewModel.switchTo() 统一发送
    }

    var body: some Commands {
        // View 菜单 - 视图相关
        CommandGroup(after: .toolbar) {
            Button("Toggle Sidebar", systemImage: "sidebar.left") {
                NSApp.keyWindow?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil)
            }
            .keyboardShortcut("\\", modifiers: .command)

            // 数据源切换：上一个/下一个（⌥⌘← / ⌥⌘→）- 循环切换
            Button("Previous Data Source") {
                switchToPreviousDataSource()
            }
            .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            .disabled(!canSwitchDataSource)

            Button("Next Data Source") {
                switchToNextDataSource()
            }
            .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            .disabled(!canSwitchDataSource)

            Divider()

            // 数据源切换（cmd+1 / cmd+2 / ... 绑定到“第 1/2/... 个启用的数据源”）
            // 通知由 DataSourceSwitchViewModel.switchTo() 统一发送
            ForEach(Array(enabledContentSources.enumerated()), id: \.element) { index, source in
                Button(source.displayName, systemImage: source.icon) {
                    contentSourceRawValue = source.rawValue
                }
                .disabled(currentSource == source)
                .applyKeyboardShortcut(shortcutKey(for: index), modifiers: .command)
                // 命令项 identity = (source, index)；当顺序变化时强制重建对应 NSMenuItem，以确保快捷键立即刷新
                .id("datasource.command.\(source.rawValue).\(index)")
            }

            Divider()

            // 全局 Filter 菜单（按当前 contentSource 切换显示内容）
            currentSourceFilterMenu

            // Highlight 菜单 - 全局高亮排序和筛选
            Menu("Highlights") {
                Section("Sort") {
                    ForEach(HighlightSortField.allCases, id: \.self) { k in
                        Button {
                            highlightSortField = k.rawValue
                            NotificationCenter.default.post(name: Notification.Name("HighlightSortChanged"), object: nil, userInfo: ["sortKey": k.rawValue])
                        } label: {
                            if highlightSortField == k.rawValue {
                                Label(k.displayName, systemImage: "checkmark")
                            } else {
                                Text(k.displayName)
                            }
                        }
                    }

                    Divider()

                    Button {
                        highlightSortAscending.toggle()
                        NotificationCenter.default.post(name: Notification.Name("HighlightSortChanged"), object: nil, userInfo: ["sortAscending": highlightSortAscending])
                    } label: {
                        if highlightSortAscending {
                            Label("Ascending", systemImage: "checkmark")
                        } else {
                            Label("Ascending", systemImage: "xmark")
                        }
                    }
                }

                Section("Filter") {
                    Button {
                        highlightHasNotes.toggle()
                        NotificationCenter.default.post(name: Notification.Name("HighlightFilterChanged"), object: nil, userInfo: ["hasNotes": highlightHasNotes])
                    } label: {
                        if highlightHasNotes {
                            Label("Has Notes", systemImage: "checkmark")
                        } else {
                            Text("Has Notes")
                        }
                    }

                    // 颜色筛选（与 FilterSortBar 的行为一致）
                    let theme: HighlightColorTheme = {
                        switch currentSource {
                        case .appleBooks: return .appleBooks
                        case .goodLinks: return .goodLinks
                        case .weRead: return .weRead
                        case .dedao: return .dedao
                        case .chats: return .appleBooks // Chats does not use highlight colors
                        }
                    }()
                    // 从位掩码恢复当前集合（0 表示空集 => 全选）
                    let currentSet: Set<Int> = {
                        if highlightSelectedMask == 0 { return [] }
                        var s: Set<Int> = []
                        for i in 0..<theme.colorCount {
                            if (highlightSelectedMask & (1 << i)) != 0 {
                                s.insert(i)
                            }
                        }
                        return s
                    }()

                    ForEach(0..<theme.colorCount, id: \.self) { colorIndex in
                        let (_, name) = theme.colorInfo(for: colorIndex)
                        // FilterSortBar 中的 isSelected 规则：空集表示"全部选中"
                        let isSelected = currentSet.isEmpty || currentSet.contains(colorIndex)
                        Button {
                            var newSet = currentSet
                            if newSet.isEmpty {
                                newSet = [colorIndex]
                            } else if newSet.contains(colorIndex) {
                                newSet.remove(colorIndex)
                                if newSet.isEmpty {
                                    newSet = []
                                }
                            } else {
                                newSet.insert(colorIndex)
                                if newSet.count == theme.colorCount {
                                    newSet = [] // 全选即视为不过滤
                                }
                            }
                            let arr = Array(newSet).sorted()
                            UserDefaults.standard.set(arr, forKey: "highlight_selected_styles")
                            // 同步写位掩码以驱动 @AppStorage 重绘
                            if newSet.isEmpty {
                                highlightSelectedMask = 0
                            } else {
                                var mask = 0
                                for i in newSet { mask |= (1 << i) }
                                highlightSelectedMask = mask
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("HighlightFilterChanged"),
                                object: nil,
                                userInfo: ["selectedStyles": arr]
                            )
                        } label: {
                            if isSelected {
                                Label(name, systemImage: "checkmark")
                            } else {
                                Text(name)
                            }
                        }
                    }
                }
            }

        }
    }
}

// MARK: - ViewCommands Filter Menu Extension

private extension ViewCommands {
    /// 根据当前数据源返回对应的筛选菜单（使用 switch 替代 if-else 链）
    @ViewBuilder
    var currentSourceFilterMenu: some View {
        switch currentSource {
        case .appleBooks:
            appleBooksFilterMenu
        case .goodLinks:
            goodLinksFilterMenu
        case .weRead:
            weReadFilterMenu
        case .dedao:
            dedaoFilterMenu
        case .chats:
            // Chats 不需要筛选菜单
            EmptyView()
        }
    }
    
    // MARK: - Apple Books Filter Menu
    
    @ViewBuilder
    var appleBooksFilterMenu: some View {
        Menu("Books") {
            Section("Sort") {
                ForEach(BookListSortKey.allCases, id: \.self) { k in
                    Button {
                        bookListSortKey = k.rawValue
                        NotificationCenter.default.post(
                            name: Notification.Name("AppleBooksFilterChanged"),
                            object: nil,
                            userInfo: ["sortKey": k.rawValue]
                        )
                    } label: {
                        if bookListSortKey == k.rawValue {
                            Label(k.displayName, systemImage: "checkmark")
                        } else {
                            Text(k.displayName)
                        }
                    }
                }

                Divider()

                Button {
                    bookListSortAscending.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("AppleBooksFilterChanged"),
                        object: nil,
                        userInfo: ["sortAscending": bookListSortAscending]
                    )
                } label: {
                    if bookListSortAscending {
                        Label("Ascending", systemImage: "checkmark")
                    } else {
                        Label("Ascending", systemImage: "xmark")
                    }
                }
            }

            Section("Filter") {
                Button {
                    bookListShowWithTitleOnly.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("AppleBooksFilterChanged"),
                        object: nil,
                        userInfo: ["showWithTitleOnly": bookListShowWithTitleOnly]
                    )
                } label: {
                    if bookListShowWithTitleOnly {
                        Label("Titles only", systemImage: "checkmark")
                    } else {
                        Text("Titles only")
                    }
                }
            }
        }
    }
    
    // MARK: - GoodLinks Filter Menu
    
    @ViewBuilder
    var goodLinksFilterMenu: some View {
        Menu("Articles") {
            Section("Sort") {
                ForEach(GoodLinksSortKey.allCases, id: \.self) { k in
                    Button {
                        goodlinksSortKey = k.rawValue
                        NotificationCenter.default.post(
                            name: Notification.Name("GoodLinksFilterChanged"),
                            object: nil,
                            userInfo: ["sortKey": k.rawValue]
                        )
                    } label: {
                        if goodlinksSortKey == k.rawValue {
                            Label(k.displayName, systemImage: "checkmark")
                        } else {
                            Text(k.displayName)
                        }
                    }
                }

                Divider()

                Button {
                    goodlinksSortAscending.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("GoodLinksFilterChanged"),
                        object: nil,
                        userInfo: ["sortAscending": goodlinksSortAscending]
                    )
                } label: {
                    if goodlinksSortAscending {
                        Label("Ascending", systemImage: "checkmark")
                    } else {
                        Label("Ascending", systemImage: "xmark")
                    }
                }
            }

            Section("Filter") {
                Button {
                    goodlinksShowStarredOnly.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("GoodLinksFilterChanged"),
                        object: nil,
                        userInfo: ["showStarredOnly": goodlinksShowStarredOnly]
                    )
                } label: {
                    if goodlinksShowStarredOnly {
                        Label("Starred only", systemImage: "checkmark")
                    } else {
                        Text("Starred only")
                    }
                }
            }
        }
    }
    
    // MARK: - WeRead Filter Menu
    
    @ViewBuilder
    var weReadFilterMenu: some View {
        Menu("Books") {
            Section("Sort") {
                // WeRead 只支持 title, highlightCount, lastSync
                let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
                ForEach(availableKeys, id: \.self) { k in
                    Button {
                        bookListSortKey = k.rawValue
                        NotificationCenter.default.post(
                            name: Notification.Name("WeReadFilterChanged"),
                            object: nil,
                            userInfo: ["sortKey": k.rawValue]
                        )
                    } label: {
                        if bookListSortKey == k.rawValue {
                            Label(k.displayName, systemImage: "checkmark")
                        } else {
                            Text(k.displayName)
                        }
                    }
                }

                Divider()

                Button {
                    bookListSortAscending.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("WeReadFilterChanged"),
                        object: nil,
                        userInfo: ["sortAscending": bookListSortAscending]
                    )
                } label: {
                    if bookListSortAscending {
                        Label("Ascending", systemImage: "checkmark")
                    } else {
                        Label("Ascending", systemImage: "xmark")
                    }
                }
            }
        }
    }
    
    // MARK: - Dedao Filter Menu
    
    @ViewBuilder
    var dedaoFilterMenu: some View {
        Menu("Books") {
            Section("Sort") {
                // Dedao 只支持 title, highlightCount, lastSync
                let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
                ForEach(availableKeys, id: \.self) { k in
                    Button {
                        bookListSortKey = k.rawValue
                        NotificationCenter.default.post(
                            name: Notification.Name("DedaoFilterChanged"),
                            object: nil,
                            userInfo: ["sortKey": k.rawValue]
                        )
                    } label: {
                        if bookListSortKey == k.rawValue {
                            Label(k.displayName, systemImage: "checkmark")
                        } else {
                            Text(k.displayName)
                        }
                    }
                }

                Divider()

                Button {
                    bookListSortAscending.toggle()
                    NotificationCenter.default.post(
                        name: Notification.Name("DedaoFilterChanged"),
                        object: nil,
                        userInfo: ["sortAscending": bookListSortAscending]
                    )
                } label: {
                    if bookListSortAscending {
                        Label("Ascending", systemImage: "checkmark")
                    } else {
                        Label("Ascending", systemImage: "xmark")
                    }
                }
            }
        }
    }
}

private extension View {
    /// 条件性应用 keyboardShortcut（避免在 `ForEach` 中写分支导致 View 类型不一致）
    @ViewBuilder
    func applyKeyboardShortcut(_ key: KeyEquivalent?, modifiers: EventModifiers) -> some View {
        if let key {
            self.keyboardShortcut(key, modifiers: modifiers)
        } else {
            self
        }
    }
}
