import SwiftUI
import AppKit
import StoreKit
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

        // Start observing IAP transactions
        DIContainer.shared.iapService.startObservingTransactions()

        // Start Auto Sync if enabled
        let autoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSyncEnabled")
        if autoSyncEnabled {
            DIContainer.shared.autoSyncService.start()
        }
    }

    var body: some Scene {
        WindowGroup {
            MainListView()
        }
        
        // 设置窗口（单实例）
        Window("Settings", id: "setting") {
            SettingsView()
        }
        .windowResizability(.contentSize)
        
        // 用户指南窗口（单实例）
        Window("SyncNos User Guide", id: "userguide") {
            UserGuideView()
        }
        .windowResizability(.contentSize)

        // 日志窗口（单实例）
        Window("Logs", id: "log") {
            LogWindow()
        }
        .windowResizability(.contentSize)
        
        // .commandsRemoved() //会移除所有系统自带的commands，不推荐使用。
        .commands {
            AppCommands()
        }
    }
}
