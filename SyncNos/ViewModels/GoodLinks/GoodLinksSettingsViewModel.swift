import Foundation
import Combine

@MainActor
final class GoodLinksSettingsViewModel: ObservableObject {
    @Published var goodLinksDbId: String = ""
    @Published var autoSync: Bool = false
    /// 数据源是否启用（影响 UI 中是否展示 GoodLinks 数据源）
    @Published var isSourceEnabled: Bool = false
    
    // MARK: - URL Fetcher Settings
    
    @Published var urlFetcherEnableCache: Bool = true
    @Published var urlFetcherEnableCookieAuth: Bool = true
    @Published var urlFetcherEnableRetry: Bool = true
    @Published var urlFetcherMaxRetries: Int = 2
    @Published var urlFetcherInitialBackoffSeconds: Double = 1.0
    @Published var urlFetcherMaxBackoffSeconds: Double = 8.0
    @Published var urlFetcherAggregateLogEvery: Int = 20
    
    @Published var message: String?

    private let notionConfig: NotionConfigStoreProtocol

    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.notionConfig = notionConfig
        if let id = notionConfig.databaseIdForSource("goodLinks") {
            self.goodLinksDbId = id
        }
        self.autoSync = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        // read datasource enabled flag（默认关闭 GoodLinks 源）
        self.isSourceEnabled = (UserDefaults.standard.object(forKey: "datasource.goodLinks.enabled") as? Bool) ?? false
        
        // URL Fetcher settings（与 GoodLinksURLFetcher 默认值保持一致）
        let defaults = UserDefaults.standard
        self.urlFetcherEnableCache = (defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.enableCache) as? Bool) ?? true
        self.urlFetcherEnableCookieAuth = (defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.enableCookieAuth) as? Bool) ?? true
        self.urlFetcherEnableRetry = (defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.enableRetry) as? Bool) ?? true
        self.urlFetcherMaxRetries = clamp(defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.maxRetries) as? Int ?? 2, min: 0, max: 10)
        self.urlFetcherInitialBackoffSeconds = max(0.1, defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.initialBackoffSeconds) as? Double ?? 1.0)
        self.urlFetcherMaxBackoffSeconds = max(self.urlFetcherInitialBackoffSeconds, defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.maxBackoffSeconds) as? Double ?? 8.0)
        self.urlFetcherAggregateLogEvery = max(1, defaults.object(forKey: GoodLinksURLFetcher.DefaultsKeys.aggregateLogEvery) as? Int ?? 20)
    }

    func save() {
        notionConfig.setDatabaseId(goodLinksDbId.trimmingCharacters(in: .whitespacesAndNewlines), forSource: "goodLinks")
        UserDefaults.standard.set(isSourceEnabled, forKey: "datasource.goodLinks.enabled")
        let previous = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.goodLinks")
        
        // URL Fetcher settings
        UserDefaults.standard.set(urlFetcherEnableCache, forKey: GoodLinksURLFetcher.DefaultsKeys.enableCache)
        UserDefaults.standard.set(urlFetcherEnableCookieAuth, forKey: GoodLinksURLFetcher.DefaultsKeys.enableCookieAuth)
        UserDefaults.standard.set(urlFetcherEnableRetry, forKey: GoodLinksURLFetcher.DefaultsKeys.enableRetry)
        UserDefaults.standard.set(clamp(urlFetcherMaxRetries, min: 0, max: 10), forKey: GoodLinksURLFetcher.DefaultsKeys.maxRetries)
        UserDefaults.standard.set(max(0.1, urlFetcherInitialBackoffSeconds), forKey: GoodLinksURLFetcher.DefaultsKeys.initialBackoffSeconds)
        UserDefaults.standard.set(max(max(0.1, urlFetcherInitialBackoffSeconds), urlFetcherMaxBackoffSeconds), forKey: GoodLinksURLFetcher.DefaultsKeys.maxBackoffSeconds)
        UserDefaults.standard.set(max(1, urlFetcherAggregateLogEvery), forKey: GoodLinksURLFetcher.DefaultsKeys.aggregateLogEvery)
        
        // 根据 per-source 开关控制 AutoSyncService 生命周期
        let anyEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks") || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        UserDefaults.standard.set(anyEnabled, forKey: "autoSyncEnabled")
        if anyEnabled {
            DIContainer.shared.autoSyncService.start()
            if !previous && autoSync {
                DIContainer.shared.autoSyncService.triggerGoodLinksNow()
            }
        } else {
            DIContainer.shared.autoSyncService.stop()
        }
        message = "Settings saved"
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if message == "Settings saved" { message = nil }
            }
        }
    }
    
    // MARK: - Helpers
    
    private func clamp(_ value: Int, min: Int, max: Int) -> Int {
        Swift.max(min, Swift.min(max, value))
    }
}
