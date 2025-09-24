import SwiftUI

@main
struct SyncNosApp: App {
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
        }
        // .windowStyle(.hiddenTitleBar)
        // Removed Settings scene to avoid NavigationStack / toolbar conflicts with Settings window.
        // Provide a menu command that opens Settings in a standalone NSWindow to avoid toolbar/nav conflicts.
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings") {
                    SettingsWindow.show()
                }
                .keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(replacing: .sidebar) {
                Button {
                    NotificationCenter.default.post(name: Notification.Name("ToggleSidebar"), object: nil)
                } label: {
                    Label("Toggle Sidebar", systemImage: "sidebar.left")
                }
                .keyboardShortcut("\\", modifiers: .command)
            }
        }
    }
}
