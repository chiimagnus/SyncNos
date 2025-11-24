import SwiftUI

// MARK: - View Commands
struct ViewCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("datasource.appleBooks.enabled") private var appleBooksSourceEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") private var goodLinksSourceEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") private var weReadSourceEnabled: Bool = false
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
        ContentSource.allCases.filter { isDataSourceEnabled($0) }
    }

    private func isDataSourceEnabled(_ source: ContentSource) -> Bool {
        switch source {
        case .appleBooks:
            return appleBooksSourceEnabled
        case .goodLinks:
            return goodLinksSourceEnabled
        case .weRead:
            return weReadSourceEnabled
        }
    }

    /// 在当前启用的数据源列表中查找指定 source 的索引（0 表示第一个、1 表示第二个、2 表示第三个）
    private func indexForSource(_ source: ContentSource) -> Int? {
        enabledContentSources.firstIndex(of: source)
    }

    /// 根据“第几个启用的数据源”返回对应的快捷键（cmd+1 / cmd+2 / cmd+3）
    private func shortcutKey(for source: ContentSource) -> KeyEquivalent? {
        guard let index = indexForSource(source) else { return nil }
        switch index {
        case 0: return "1"
        case 1: return "2"
        case 2: return "3"
        default: return nil
        }
    }

    var body: some Commands {
        // View 菜单 - 视图相关
        CommandGroup(after: .toolbar) {
            Button("Toggle Sidebar", systemImage: "sidebar.left") {
                NSApp.keyWindow?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil)
            }
            .keyboardShortcut("\\", modifiers: .command)

            Button("Refresh", systemImage: "arrow.clockwise") {
                NotificationCenter.default.post(name: Notification.Name("RefreshBooksRequested"), object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
            Divider()

            // 数据源切换（cmd+1 / cmd+2 / cmd+3 绑定到“第 1/2/3 个启用的数据源”）
            if isDataSourceEnabled(.appleBooks) {
                if let key = shortcutKey(for: .appleBooks) {
                    Button("Apple Books", systemImage: "book") {
                        contentSourceRawValue = ContentSource.appleBooks.rawValue
                    }
                    .keyboardShortcut(key, modifiers: .command)
                    .disabled(currentSource == .appleBooks)
                } else {
                    Button("Apple Books", systemImage: "book") {
                        contentSourceRawValue = ContentSource.appleBooks.rawValue
                    }
                    .disabled(currentSource == .appleBooks)
                }
            }

            if isDataSourceEnabled(.goodLinks) {
                if let key = shortcutKey(for: .goodLinks) {
                    Button("GoodLinks", systemImage: "bookmark") {
                        contentSourceRawValue = ContentSource.goodLinks.rawValue
                    }
                    .keyboardShortcut(key, modifiers: .command)
                    .disabled(currentSource == .goodLinks)
                } else {
                    Button("GoodLinks", systemImage: "bookmark") {
                        contentSourceRawValue = ContentSource.goodLinks.rawValue
                    }
                    .disabled(currentSource == .goodLinks)
                }
            }

            if isDataSourceEnabled(.weRead) {
                if let key = shortcutKey(for: .weRead) {
                    Button("WeRead", systemImage: "text.book.closed") {
                        contentSourceRawValue = ContentSource.weRead.rawValue
                    }
                    .keyboardShortcut(key, modifiers: .command)
                    .disabled(currentSource == .weRead)
                } else {
                    Button("WeRead", systemImage: "text.book.closed") {
                        contentSourceRawValue = ContentSource.weRead.rawValue
                    }
                    .disabled(currentSource == .weRead)
                }
            }

            Divider()

            // 全局 Filter 菜单（按当前 contentSource 切换显示内容） — 展平为一级命令
            if currentSource == .appleBooks {
                // Apple Books 的排序和筛选菜单
                Menu("Books", systemImage: "book.closed") {
                    Section("Sort") {
                        ForEach(BookListSortKey.allCases, id: \.self) { k in
                            Button {
                                bookListSortKey = k.rawValue
                                NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["sortKey": k.rawValue])
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
                            NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["sortAscending": bookListSortAscending])
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
                            NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["showWithTitleOnly": bookListShowWithTitleOnly])
                        } label: {
                            if bookListShowWithTitleOnly {
                                Label("Titles only", systemImage: "checkmark")
                            } else {
                                Text("Titles only")
                            }
                        }
                    }
                }
            } else if currentSource == .goodLinks {
                // GoodLinks 的排序和筛选菜单
                Menu("Articles", systemImage: "doc.text") {
                    Section("Sort") {
                        ForEach(GoodLinksSortKey.allCases, id: \.self) { k in
                            Button {
                                goodlinksSortKey = k.rawValue
                                NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["sortKey": k.rawValue])
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
                            NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["sortAscending": goodlinksSortAscending])
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
                            NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["showStarredOnly": goodlinksShowStarredOnly])
                        } label: {
                            if goodlinksShowStarredOnly {
                                Label("Starred only", systemImage: "checkmark")
                            } else {
                                Text("Starred only")
                            }
                        }
                    }
                }
            } else {
                // WeRead 的排序和筛选菜单
                Menu("Books", systemImage: "book.closed") {
                    Section("Sort") {
                        // WeRead 只支持 title, highlightCount, lastSync
                        let availableKeys: [BookListSortKey] = [.title, .highlightCount, .lastSync]
                        ForEach(availableKeys, id: \.self) { k in
                            Button {
                                bookListSortKey = k.rawValue
                                NotificationCenter.default.post(name: Notification.Name("WeReadFilterChanged"), object: nil, userInfo: ["sortKey": k.rawValue])
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
                            NotificationCenter.default.post(name: Notification.Name("WeReadFilterChanged"), object: nil, userInfo: ["sortAscending": bookListSortAscending])
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

            // Highlight 菜单 - 全局高亮排序和筛选
            Menu("Highlight", systemImage: "highlighter") {
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

                    // 颜色筛选（与 FiltetSortBar 的行为一致）
                    let theme: HighlightColorTheme = {
                        switch currentSource {
                        case .appleBooks: return .appleBooks
                        case .goodLinks: return .goodLinks
                        case .weRead: return .weRead
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
                        // FiltetSortBar 中的 isSelected 规则：空集表示"全部选中"
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

            Divider()
        }
    }
}
