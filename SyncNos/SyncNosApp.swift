import SwiftUI
import SwiftData
import StoreKit

@main
struct SyncNosApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    /// 使用 AppStorage 监听图标显示模式变化，自动控制 MenuBarExtra 可见性
    /// 默认值为 0（.both），即同时在菜单栏和 Dock 显示
    @AppStorage(AppIconDisplayMode.userDefaultsKey) private var iconDisplayModeRaw: Int = 0
    
    /// 计算菜单栏图标是否应该显示（Binding 用于 MenuBarExtra isInserted 参数）
    private var menuBarIconInserted: Binding<Bool> {
        Binding(
            get: {
                let mode = AppIconDisplayMode(rawValue: iconDisplayModeRaw) ?? .both
                return mode.showsMenuBarIcon
            },
            set: { newValue in
                // 只在用户从菜单栏手动移除图标时处理
                // 如果当前模式已经是 dockOnly，说明是我们主动设置的，不需要再处理
                let currentMode = AppIconDisplayMode(rawValue: iconDisplayModeRaw) ?? .both
                if !newValue && currentMode != .dockOnly {
                    // 用户从菜单栏手动移除了图标，切换到 dockOnly 模式
                    iconDisplayModeRaw = AppIconDisplayMode.dockOnly.rawValue
                    // 延迟执行以避免 UI 更新冲突
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        AppIconDisplayViewModel.applyStoredMode()
                    }
                }
            }
        )
    }
    
    init() {
        // 注意：图标显示模式的应用延迟到 AppDelegate.applicationDidFinishLaunching
        // 因为 NSApp 在 App.init() 阶段尚未初始化
#if DEBUG
        // Debug flag：通过 UserDefaults(debug.forceOnboardingEveryLaunch) 控制是否每次启动都重置引导状态
        // 默认关闭，需要时可在 Xcode Scheme 的 Arguments 中设置，或手动在代码中临时改为 true
        UserDefaults.standard.register(defaults: ["debug.forceOnboardingEveryLaunch": false])
        let envDetector = DIContainer.shared.environmentDetector
        let shouldForceOnboarding = UserDefaults.standard.bool(forKey: "debug.forceOnboardingEveryLaunch")
        if envDetector.isDevEnvironment() && shouldForceOnboarding {
            UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
        }
#endif
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
        let autoSyncEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks") 
            || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
            || UserDefaults.standard.bool(forKey: "autoSync.weRead")
        if autoSyncEnabled { DIContainer.shared.autoSyncService.start() }

        // 初始化同步状态监控，确保尽早开始监听通知
        _ = DIContainer.shared.syncActivityMonitor
        // 初始化同步队列存储，确保尽早开始监听入队/状态事件
        _ = DIContainer.shared.syncQueueStore
        
        // 初始化 WeRead 缓存服务（预热 SwiftData ModelContainer）
        _ = DIContainer.shared.weReadCacheService
        DIContainer.shared.loggerService.info("WeRead cache service initialized")
        
        // 初始化已同步高亮记录存储（用于避免遍历 Notion children）
        _ = DIContainer.shared.syncedHighlightStore
        DIContainer.shared.loggerService.info("SyncedHighlightStore initialized")
        
        // 检查加密密钥健康状态（用于诊断解密失败问题）
        checkEncryptionKeyHealth()
    }
    
    /// 检查加密密钥健康状态并记录日志
    private func checkEncryptionKeyHealth() {
        let healthStatus = EncryptionService.shared.validateKeyHealth()
        let logger = DIContainer.shared.loggerService
        
        switch healthStatus {
        case .healthy:
            logger.info("[Encryption] Key health check passed - encryption key is available")
        case .newlyGenerated:
            logger.warning("[Encryption] ⚠️ New encryption key was generated - previously encrypted chat data cannot be decrypted")
            // 可以在这里添加用户提示逻辑，告知用户数据无法恢复
        case .unavailable(let reason):
            logger.error("[Encryption] ❌ Encryption key unavailable: \(reason)")
        }
    }

    var body: some Scene {
        // 隐藏可见窗口标题（保留重新打开时的 id），以避免在工具栏中显示应用程序名称。
        Window("", id: "main") {
            RootView()
        }
        .windowStyle(.hiddenTitleBar) //隐藏标题栏
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
                .applyFontScale()
        }
        .windowResizability(.contentSize)
        
        // 菜单栏项（根据图标显示模式动态显示/隐藏）
        MenuBarExtra("SyncNos", image: "MenuBarIcon", isInserted: menuBarIconInserted) {
            MenuBarView()
        }
    }
}
