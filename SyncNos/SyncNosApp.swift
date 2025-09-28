import SwiftUI
import AppKit

// 创建环境变量来管理侧边栏状态
private struct SidebarVisibilityKey: EnvironmentKey {
    static let defaultValue: Binding<NavigationSplitViewVisibility> = .constant(.all)
}

extension EnvironmentValues {
    var sidebarVisibility: Binding<NavigationSplitViewVisibility> {
        get { self[SidebarVisibilityKey.self] }
        set { self[SidebarVisibilityKey.self] = newValue }
    }
}

@main
struct SyncNosApp: App {
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    init() {
        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            DIContainer.shared.loggerService.info("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            DIContainer.shared.loggerService.warning("No saved bookmark to restore")
        }
    }
    
    var body: some Scene {
        WindowGroup {
            BooksListView()
                .environment(\.sidebarVisibility, $columnVisibility)
        }
        // .windowStyle(.hiddenTitleBar)
        // Removed Settings scene to avoid NavigationStack / toolbar conflicts with Settings window.
        // Provide a menu command that opens Settings in a standalone NSWindow to avoid toolbar/nav conflicts.
        .commands {
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
            CommandGroup(after: .newItem) {
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
                    columnVisibility = columnVisibility == .all ? .detailOnly : .all
                }
                .keyboardShortcut("\\", modifiers: .command)

                Button("Refresh Books", systemImage: "arrow.clockwise") {
                    // 刷新书籍列表的逻辑
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
            CommandGroup(after: .help) {
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
