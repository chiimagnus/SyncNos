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
            CommandGroup(replacing: .sidebar) {
                Button("Toggle Sidebar", systemImage: "sidebar.left") {
                    columnVisibility = columnVisibility == .all ? .detailOnly : .all
                }
                .keyboardShortcut("\\", modifiers: .command)
            }
        }
    }

    private func openAppStoreReview() {
        // TODO: 替换为你的实际 App Store ID
        let appStoreID = "6752426176" // 示例 ID，需要替换为实际的应用 ID
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
