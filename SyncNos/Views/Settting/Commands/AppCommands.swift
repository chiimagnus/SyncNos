import SwiftUI

// 将应用菜单命令抽取到单独文件，便于维护与测试
struct AppCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("contentSource") private var contentSourceRawValue: String = ContentSource.appleBooks.rawValue
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
                // Apple Books 的一级命令
                Picker("Sort", selection: Binding(get: {
                    UserDefaults.standard.string(forKey: "bookList_sort_key") ?? BookListSortKey.title.rawValue
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "bookList_sort_key")
                    NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["sortKey": new])
                })) {
                    ForEach(BookListSortKey.allCases, id: \.self) { k in
                        Text(k.displayName).tag(k.rawValue)
                    }
                }

                Toggle("Ascending", isOn: Binding(get: {
                    UserDefaults.standard.bool(forKey: "bookList_sort_ascending")
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "bookList_sort_ascending")
                    NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["sortAscending": new])
                }))

                Toggle("Books with titles only", isOn: Binding(get: {
                    UserDefaults.standard.bool(forKey: "bookList_showWithTitleOnly")
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "bookList_showWithTitleOnly")
                    NotificationCenter.default.post(name: Notification.Name("AppleBooksFilterChanged"), object: nil, userInfo: ["showWithTitleOnly": new])
                }))

                Divider()
            } else {
                // GoodLinks 的一级命令
                Picker("Sort", selection: Binding(get: {
                    UserDefaults.standard.string(forKey: "goodlinks_sort_key") ?? GoodLinksSortKey.modified.rawValue
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "goodlinks_sort_key")
                    NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["sortKey": new])
                })) {
                    ForEach(GoodLinksSortKey.allCases, id: \.self) { k in
                        Text(k.displayName).tag(k.rawValue)
                    }
                }

                Toggle("Ascending", isOn: Binding(get: {
                    UserDefaults.standard.bool(forKey: "goodlinks_sort_ascending")
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "goodlinks_sort_ascending")
                    NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["sortAscending": new])
                }))

                Toggle("Starred only", isOn: Binding(get: {
                    UserDefaults.standard.bool(forKey: "goodlinks_show_starred_only")
                }, set: { new in
                    UserDefaults.standard.set(new, forKey: "goodlinks_show_starred_only")
                    NotificationCenter.default.post(name: Notification.Name("GoodLinksFilterChanged"), object: nil, userInfo: ["showStarredOnly": new])
                }))

                Divider()
            }
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
