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
        self.autoSync = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
    }

    func save() {
        notionConfig.setDatabaseId(goodLinksDbId.trimmingCharacters(in: .whitespacesAndNewlines), forSource: "goodLinks")
        UserDefaults.standard.set(autoSync, forKey: "autoSync.goodLinks")
        message = "Settings saved"
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if message == "Settings saved" { message = nil }
            }
        }
    }
}