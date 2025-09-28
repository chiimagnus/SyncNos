import SwiftUI
import AppKit

// 将应用菜单命令抽取到单独文件，便于维护与测试
struct AppCommands: Commands {

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
        // SyncNos 应用菜单 - 应用设置相关
        CommandGroup(replacing: .appSettings) {
            Button("Settings", systemImage: "gear") {
                SettingsWindow.show()
            }
            .keyboardShortcut(",", modifiers: .command)
        }

        CommandGroup(after: .appSettings) {
            Button("Please give five stars", systemImage: "heart") {
                openAppStoreReview()
            }
            Button("Report Issues & Suggestions", systemImage: "ladybug") {
                openGitHubRepo()
            }
            Button("View Source Code", systemImage: "link") {
                openGitHubSource()
            }
        }

        // File 菜单 - 文件操作相关
        CommandGroup(replacing: .newItem) {
            Button("Import Books", systemImage: "plus.rectangle") {
                // 导入书籍的逻辑
            }
            .keyboardShortcut("i", modifiers: .command)
        }

        // Edit 菜单 - 编辑操作相关
        CommandGroup(after: .textEditing) {
            Button("Find in Books", systemImage: "magnifyingglass") {
                // 在书籍中搜索的逻辑
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])
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
        }

        // Window 菜单 - 窗口管理相关
        CommandGroup(after: .windowList) {
            Button("Book Detail Window", systemImage: "book") {
                // 打开书籍详情窗口的逻辑
            }
            .keyboardShortcut("1", modifiers: [.command, .shift])
        }

        // Help 菜单 - 帮助相关
        CommandGroup(replacing: .help) {
            Button("SyncNos User Guide", systemImage: "questionmark.circle") {
                // 打开用户指南的逻辑
            }
            .keyboardShortcut("?", modifiers: .command)

            Button("Keyboard Shortcuts", systemImage: "keyboard") {
                // 显示快捷键列表的逻辑
            }
            .keyboardShortcut("/", modifiers: [.command, .shift])
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


