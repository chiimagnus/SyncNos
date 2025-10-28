import SwiftUI

// 将应用菜单命令抽取到单独文件，便于维护与测试
struct AppCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
    @AppStorage("bookList_sort_key") private var bookListSortKey: String = BookListSortKey.title.rawValue
    @AppStorage("bookList_sort_ascending") private var bookListSortAscending: Bool = true
    @AppStorage("bookList_showWithTitleOnly") private var bookListShowWithTitleOnly: Bool = false
    @AppStorage("goodlinks_sort_key") private var goodlinksSortKey: String = GoodLinksSortKey.modified.rawValue
    @AppStorage("goodlinks_sort_ascending") private var goodlinksSortAscending: Bool = false
    @AppStorage("goodlinks_show_starred_only") private var goodlinksShowStarredOnly: Bool = false
    @AppStorage("highlight_sort_key") private var highlightSortKey: String = HighlightSortKey.created.rawValue
    @AppStorage("highlight_sort_ascending") private var highlightSortAscending: Bool = false
    @AppStorage("highlight_has_notes") private var highlightHasNotes: Bool = false
    @FocusedValue(\.selectionCommands) private var selectionCommands: SelectionCommands?

    init() {
        // 禁用自动窗口标签，从而隐藏 "Show Tab" 和 "Show All Tabs" 菜单项
        NSWindow.allowsAutomaticWindowTabbing = false

        // 确保系统中任何绑定到 toggleSidebar 的菜单项都使用我们想要的快捷键（Cmd+\）
        DispatchQueue.main.async {
            let selector = #selector(NSSplitViewController.toggleSidebar(_:))
            guard let mainMenu = NSApp.mainMenu else { return }

            func normalize(menu: NSMenu) {
                for item in menu.items {
                    if item.action == selector {
                        item.keyEquivalent = "\\"
                        item.keyEquivalentModifierMask = [.command]
                    }
                    if let submenu = item.submenu {
                        normalize(menu: submenu)
                    }
                }
            }

            normalize(menu: mainMenu)
        }
    }

    var body: some Commands {
        // 替换系统自带的 About 面板，改为打开我们的自定义 About 窗口
        CommandGroup(replacing: .appInfo) {}

        // SyncNos 应用菜单 - 应用设置相关
        CommandGroup(replacing: .appSettings) {
            Button("Settings", systemImage: "gear") {
                openWindow(id: "setting")
            }
            .keyboardShortcut(",", modifiers: .command)
        }

        // File 菜单 - 文件操作相关
        CommandGroup(replacing: .newItem) {
            Button("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle") {
                NotificationCenter.default.post(name: Notification.Name("SyncSelectedToNotionRequested"), object: nil)
            }
            .keyboardShortcut("s", modifiers: [.command, .option])
        }

        // Edit 菜单 - 编辑操作相关（仅在列表获得焦点时启用）
        CommandGroup(replacing: .pasteboard) {
            Button("Select All", systemImage: "character.textbox") {
                selectionCommands?.selectAll()
            }
            .keyboardShortcut("a", modifiers: [.command])
            .disabled(!(selectionCommands?.canSelectAll() ?? false))

            Button("Deselect", systemImage: "character.textbox.badge.sparkles") {
                selectionCommands?.deselectAll()
            }
            .keyboardShortcut(.escape)
            .disabled(!(selectionCommands?.canDeselect() ?? false))
        }

        // View 菜单 - 视图相关
        CommandGroup(after: .toolbar) {
            Button("Toggle Sidebar", systemImage: "sidebar.left") {
                NSApp.keyWindow?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil)
            }
            .keyboardShortcut("\\", modifiers: .command)

            Button("Refresh Books", systemImage: "arrow.clockwise") {
                NotificationCenter.default.post(name: Notification.Name("RefreshBooksRequested"), object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)


            Divider()

            // 数据源切换
            Button("Apple Books", systemImage: "book") {
                contentSourceRawValue = ContentSource.appleBooks.rawValue
            }
            .keyboardShortcut("1", modifiers: .command)
            .disabled(contentSourceRawValue == ContentSource.appleBooks.rawValue)

            Button("GoodLinks", systemImage: "bookmark") {
                contentSourceRawValue = ContentSource.goodLinks.rawValue
            }
            .keyboardShortcut("2", modifiers: .command)
            .disabled(contentSourceRawValue == ContentSource.goodLinks.rawValue)

            Divider()

            // 全局 Filter 菜单（按当前 contentSource 切换显示内容） — 展平为一级命令
            if ContentSource(rawValue: contentSourceRawValue) == .appleBooks {
                // Apple Books 的排序和筛选菜单
                Menu("Books", systemImage: "line.3.horizontal.decrease.circle") {
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
                                Label("Books with titles only", systemImage: "checkmark")
                            } else {
                                Text("Books with titles only")
                            }
                        }
                    }
                }
            } else {
                // GoodLinks 的排序和筛选菜单
                Menu("Articles", systemImage: "line.3.horizontal.decrease.circle") {
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
            }

            // Highlight 菜单 - 全局高亮排序和筛选
            Menu("Highlight", systemImage: "highlighter") {
                Section("Sort") {
                    ForEach(HighlightSortKey.allCases, id: \.self) { k in
                        Button {
                            highlightSortKey = k.rawValue
                            NotificationCenter.default.post(name: Notification.Name("HighlightSortChanged"), object: nil, userInfo: ["sortKey": k.rawValue])
                        } label: {
                            if highlightSortKey == k.rawValue {
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
                    Toggle("Has Notes", isOn: Binding(
                        get: { highlightHasNotes },
                        set: { isOn in
                            highlightHasNotes = isOn
                            NotificationCenter.default.post(name: Notification.Name("HighlightFilterChanged"), object: nil, userInfo: ["hasNotes": isOn])
                        }
                    ))

                    // TODO: 颜色筛选可以后续添加
                    Button {
                        // 颜色筛选逻辑可以后续实现
                    } label: {
                        Text("Color (Coming Soon)")
                    }
                    .disabled(true)
                }
            }

            Divider()
        }

        // Window 菜单 - 窗口管理相关
        CommandGroup(replacing: .singleWindowList) {}

        // Help 菜单 - 帮助相关
        CommandGroup(replacing: .help) {
            Button("SyncNos User Guide", systemImage: "questionmark.circle") {
                openWindow(id: "userguide")
            }

            Divider()

            Button("Please give five stars", systemImage: "heart") {
                openAppStoreReview()
            }

            Button("Report Issues & Suggestions", systemImage: "ladybug") {
                openGitHubRepo()
            }

            Button("View Source Code", systemImage: "link") {
                openGitHubSource()
            }

            Divider()

            Button("Show Logs", systemImage: "doc.text.magnifyingglass") {
                openWindow(id: "log")
            }
            .keyboardShortcut("l", modifiers: .command)
        }
    }

    private func openAppStoreReview() {
        let appStoreID = "6752426176"
        let appStoreURL = URL(string: "macappstore://apps.apple.com/app/id\(appStoreID)")!
        let webURL = URL(string: "https://apps.apple.com/app/id\(appStoreID)")!

        // 尝试打开 App Store 应用，如果失败则打开网页版本
        if !NSWorkspace.shared.open(appStoreURL) {
            NSWorkspace.shared.open(webURL)
        }
    }

    private func openGitHubRepo() {
        let githubURL = URL(string: "https://github.com/chiimagnus/SyncNos/issues")!
        NSWorkspace.shared.open(githubURL)
    }

    private func openGitHubSource() {
        let githubURL = URL(string: "https://github.com/chiimagnus/SyncNos")!
        NSWorkspace.shared.open(githubURL)
    }
}
