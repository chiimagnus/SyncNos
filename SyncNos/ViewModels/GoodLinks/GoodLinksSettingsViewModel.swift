import Foundation
import Combine

@MainActor
final class GoodLinksSettingsViewModel: ObservableObject {
    @Published var goodLinksDbId: String = ""
    @Published var autoSync: Bool = false
    /// 数据源是否启用（影响 UI 中是否展示 GoodLinks 数据源）
    @Published var isSourceEnabled: Bool = false
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
    }

    func save() {
        notionConfig.setDatabaseId(goodLinksDbId.trimmingCharacters(in: .whitespacesAndNewlines), forSource: "goodLinks")
        UserDefaults.standard.set(isSourceEnabled, forKey: "datasource.goodLinks.enabled")
        let previous = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.goodLinks")
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
}