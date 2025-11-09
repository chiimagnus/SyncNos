import Foundation
import Combine

@MainActor
final class GoodLinksSettingsViewModel: ObservableObject {
    @Published var goodLinksDbId: String = ""
    @Published var autoSync: Bool = false
    @Published var message: String?

    private let notionConfig: NotionConfigStoreProtocol

    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.notionConfig = notionConfig
        if let id = notionConfig.databaseIdForSource("goodLinks") {
            self.goodLinksDbId = id
        }
        self.autoSync = SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks")
    }

    func save() {
        notionConfig.setDatabaseId(goodLinksDbId.trimmingCharacters(in: .whitespacesAndNewlines), forSource: "goodLinks")
        let previous = SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks")
        SharedDefaults.userDefaults.set(autoSync, forKey: "autoSync.goodLinks")
        // 根据 per-source 开关控制 AutoSyncService 生命周期
        let anyEnabled = SharedDefaults.userDefaults.bool(forKey: "autoSync.appleBooks") || SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks")
        SharedDefaults.userDefaults.set(anyEnabled, forKey: "autoSyncEnabled")
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