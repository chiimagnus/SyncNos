import Foundation

@MainActor
final class WeReadSettingsViewModel: ObservableObject {
    @Published var weReadDbId: String = ""
    @Published var autoSync: Bool = false
    /// 数据源是否启用（影响 UI 中是否展示 WeRead 数据源）
    @Published var isSourceEnabled: Bool = false
    @Published var message: String?
    @Published var isLoggedIn: Bool = false
    @Published var showLoginSheet: Bool = false

    private let notionConfig: NotionConfigStoreProtocol
    private let authService: WeReadAuthServiceProtocol
    private let autoSyncService: AutoSyncServiceProtocol

    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService
    ) {
        self.notionConfig = notionConfig
        self.authService = authService
        self.autoSyncService = autoSyncService

        if let id = notionConfig.databaseIdForSource("weRead") {
            self.weReadDbId = id
        }
        self.autoSync = UserDefaults.standard.bool(forKey: "autoSync.weRead")
        // read datasource enabled flag（默认关闭 WeRead 源）
        self.isSourceEnabled = (UserDefaults.standard.object(forKey: "datasource.weRead.enabled") as? Bool) ?? false
        refreshLoginStatus()
    }

    func refreshLoginStatus() {
        isLoggedIn = authService.isLoggedIn
    }

    func save() {
        notionConfig.setDatabaseId(
            weReadDbId.trimmingCharacters(in: .whitespacesAndNewlines),
            forSource: "weRead"
        )
        UserDefaults.standard.set(isSourceEnabled, forKey: "datasource.weRead.enabled")

        let previous = UserDefaults.standard.bool(forKey: "autoSync.weRead")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.weRead")

        // 根据 per-source 开关控制 AutoSyncService 生命周期
        let anyEnabled =
            UserDefaults.standard.bool(forKey: "autoSync.appleBooks") ||
            UserDefaults.standard.bool(forKey: "autoSync.goodLinks") ||
            UserDefaults.standard.bool(forKey: "autoSync.weRead")

        UserDefaults.standard.set(anyEnabled, forKey: "autoSyncEnabled")
        if anyEnabled {
            autoSyncService.start()
            // 首次启用 WeRead 自动同步时，立即触发一次同步
            if !previous && autoSync {
                autoSyncService.triggerWeReadNow()
            }
        } else {
            autoSyncService.stop()
        }

        message = "Settings saved"
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if self.message == "Settings saved" {
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
                message = String(localized: "Logged Out")
                // 发送登录状态变化通知，让 WeReadListView/WeReadViewModel 更新 UI
                NotificationCenter.default.post(name: .weReadLoginStatusChanged, object: nil)
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if self.message == String(localized: "Logged Out") {
                    self.message = nil
                }
            }
        }
    }
}
