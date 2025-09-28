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
    // @State private var columnVisibility = NavigationSplitViewVisibility.all

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
                // .environment(\.sidebarVisibility, $columnVisibility)
        }
        // .windowStyle(.hiddenTitleBar)
        // Removed Settings scene to avoid NavigationStack / toolbar conflicts with Settings window.
        // Provide a menu command that opens Settings in a standalone NSWindow to avoid toolbar/nav conflicts.
        // .commandsRemoved() //会移除所有系统自带的commands，不推荐使用。
        .commands {
            AppCommands()
        }
    }

    // 命令相关逻辑已抽取到 `SyncNos/SyncNos/Commands/AppCommands.swift`
}
