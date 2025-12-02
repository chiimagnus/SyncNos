import Foundation

@MainActor
final class DedaoSettingsViewModel: ObservableObject {
    @Published var dedaoDbId: String = ""
    @Published var autoSync: Bool = false
    /// 数据源是否启用（影响 UI 中是否展示 Dedao 数据源）
    @Published var isSourceEnabled: Bool = false
    @Published var message: String?
    @Published var isLoggedIn: Bool = false
    @Published var showLoginSheet: Bool = false
    
    private let notionConfig: NotionConfigStoreProtocol
    private let authService: DedaoAuthServiceProtocol
    private let autoSyncService: AutoSyncServiceProtocol
    
    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        authService: DedaoAuthServiceProtocol,
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService
    ) {
        self.notionConfig = notionConfig
        self.authService = authService
        self.autoSyncService = autoSyncService
        
        if let id = notionConfig.databaseIdForSource("dedao") {
            self.dedaoDbId = id
        }
        self.autoSync = UserDefaults.standard.bool(forKey: "autoSync.dedao")
        // read datasource enabled flag（默认关闭 Dedao 源）
        self.isSourceEnabled = (UserDefaults.standard.object(forKey: "datasource.dedao.enabled") as? Bool) ?? false
        refreshLoginStatus()
    }
    
    func refreshLoginStatus() {
        isLoggedIn = authService.isLoggedIn
    }
    
    func save() {
        notionConfig.setDatabaseId(
            dedaoDbId.trimmingCharacters(in: .whitespacesAndNewlines),
            forSource: "dedao"
        )
        UserDefaults.standard.set(isSourceEnabled, forKey: "datasource.dedao.enabled")
        
        let previous = UserDefaults.standard.bool(forKey: "autoSync.dedao")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.dedao")
        
        // 根据 per-source 开关控制 AutoSyncService 生命周期
        let anyEnabled =
            UserDefaults.standard.bool(forKey: "autoSync.appleBooks") ||
            UserDefaults.standard.bool(forKey: "autoSync.goodLinks") ||
            UserDefaults.standard.bool(forKey: "autoSync.weRead") ||
            UserDefaults.standard.bool(forKey: "autoSync.dedao")
        
        UserDefaults.standard.set(anyEnabled, forKey: "autoSyncEnabled")
        if anyEnabled {
            autoSyncService.start()
            // 首次启用 Dedao 自动同步时，立即触发一次同步
            if !previous && autoSync {
                autoSyncService.triggerDedaoNow()
            }
        } else {
            autoSyncService.stop()
        }
        
        message = String(localized: "settings.saved")
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if self.message == String(localized: "settings.saved") {
                    self.message = nil
                }
            }
        }
    }
    
    func clearLogin() {
        Task {
            await authService.clearCookies()
            await MainActor.run {
                refreshLoginStatus()
                message = String(localized: "dedao.loggedOut")
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if self.message == String(localized: "dedao.loggedOut") {
                    self.message = nil
                }
            }
        }
    }
}

