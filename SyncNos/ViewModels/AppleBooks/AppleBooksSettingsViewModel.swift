import Foundation
import Combine

@MainActor
final class AppleBooksSettingsViewModel: ObservableObject {
    @Published var syncMode: String = "single"
    @Published var appleBooksDbId: String = ""
    @Published var autoSync: Bool = false
    @Published var message: String?

    private let notionConfig: NotionConfigStoreProtocol
    private var cancellables = Set<AnyCancellable>()

    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.notionConfig = notionConfig
        self.syncMode = notionConfig.syncMode ?? "single"
        if let id = notionConfig.databaseIdForSource("appleBooks") {
            self.appleBooksDbId = id
        }
        // read autoSync flag from AppStorage via UserDefaults bridge
        self.autoSync = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")

        // keep syncMode in sync if external changes happen
        // no external publisher available; omit
    }

    func save() {
        notionConfig.setDatabaseId(appleBooksDbId.trimmingCharacters(in: .whitespacesAndNewlines), forSource: "appleBooks")
        notionConfig.syncMode = syncMode.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(autoSync, forKey: "autoSync.appleBooks")
        // 根据 per-source 开关控制 AutoSyncService 生命周期
        let anyEnabled = UserDefaults.standard.bool(forKey: "autoSync.appleBooks") || UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        UserDefaults.standard.set(anyEnabled, forKey: "autoSyncEnabled")
        if anyEnabled {
            DIContainer.shared.autoSyncService.start()
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

    func saveSyncMode() {
        notionConfig.syncMode = syncMode.trimmingCharacters(in: .whitespacesAndNewlines)
        message = "Sync mode saved"
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if message == "Sync mode saved" { message = nil }
            }
        }
    }
}