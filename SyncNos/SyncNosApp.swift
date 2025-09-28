import SwiftUI
import AppKit


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
        
        // .commandsRemoved() //会移除所有系统自带的commands，不推荐使用。
        .commands {
            AppCommands()
        }
    }
}
