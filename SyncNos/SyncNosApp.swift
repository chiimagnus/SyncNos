import SwiftUI
import AppKit
import StoreKit
@main
struct SyncNosApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    init() {
        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            DIContainer.shared.loggerService.info("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            DIContainer.shared.loggerService.warning("No saved bookmark to restore")
        }

        // 迁移 UserDefaults 到 App Group（仅一次）
        SharedDefaults.shared.migrateIfNeeded()

        // 若用户曾启用后台活动，则确保存活登录项已注册（忽略错误）
        if SharedDefaults.shared.bool(forKey: "backgroundActivity.enabled") {
            do {
                try BackgroundLoginItemService.register()
            } catch {
                DIContainer.shared.loggerService.warning("Background login item register failed: \(error)")
            }
        }

        // Start observing IAP transactions
        DIContainer.shared.iapService.startObservingTransactions()

        // Start Auto Sync if any source enabled
        let autoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks") || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        if autoSyncEnabled { DIContainer.shared.autoSyncService.start() }

        // 初始化同步状态监控，确保尽早开始监听通知
        _ = DIContainer.shared.syncActivityMonitor
        // 初始化同步队列存储，确保尽早开始监听入队/状态事件
        _ = DIContainer.shared.syncQueueStore
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
