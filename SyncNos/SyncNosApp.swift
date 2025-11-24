import SwiftUI
import AppKit
import StoreKit
@main
struct SyncNosApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @AppStorage("hasCompletedOnboarding") var hasCompletedOnboarding: Bool = false
    
    init() {
        // 开发环境：每次启动都重置引导完成标记，方便反复体验 Onboarding
        let envDetector = DIContainer.shared.environmentDetector
        if envDetector.isDevEnvironment() {
            UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
        }

        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            DIContainer.shared.loggerService.info("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            DIContainer.shared.loggerService.warning("No saved bookmark to restore")
        }

        // Start observing IAP transactions and check trial status
        DIContainer.shared.iapService.startObservingTransactions()
        
        // Initialize trial period (records first launch if needed)
        let iapService = DIContainer.shared.iapService
        if iapService.isInTrialPeriod {
            DIContainer.shared.loggerService.info("Trial period active: \(iapService.trialDaysRemaining) days remaining")
        } else if !iapService.hasPurchased {
            DIContainer.shared.loggerService.warning("Trial period expired, purchase required")
        }
        
        // 启动时刷新订阅状态（检查是否过期）
        Task {
            await DIContainer.shared.iapService.refreshPurchasedStatus()
        }

        // Start Auto Sync if any source enabled
        let autoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks") || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        if autoSyncEnabled { DIContainer.shared.autoSyncService.start() }

        // 初始化同步状态监控，确保尽早开始监听通知
        _ = DIContainer.shared.syncActivityMonitor
        // 初始化同步队列存储，确保尽早开始监听入队/状态事件
        _ = DIContainer.shared.syncQueueStore
    }

    var body: some Scene {
        // 隐藏可见窗口标题（保留重新打开时的 id），以避免在工具栏中显示应用程序名称。
        Window("", id: "main") {
            Group {
                if hasCompletedOnboarding {
                    MainListView()
                        .transition(.opacity)
                } else {
                    OnboardingView()
                        .transition(.opacity)
                }
            }
            .animation(.spring(), value: hasCompletedOnboarding)
        }
        .commands {
            AppCommands()
        }
        
        // 设置窗口（单实例）
        Window("Settings", id: "setting") {
            SettingsView()
        }
        .windowResizability(.contentSize)
        
        // 日志窗口（单实例）
        Window("Logs", id: "log") {
            LogWindow()
        }
        .windowResizability(.contentSize)
        
        // 菜单栏项
        MenuBarExtra("SyncNos", image: "MenuBarIcon") {
            MenuBarView()
        }
    }
}
