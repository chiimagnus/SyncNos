import Foundation

@MainActor
final class NotionIntegrationViewModel: ObservableObject {
    @Published var notionKeyInput: String = ""
    @Published var notionPageIdInput: String = ""
    
    @Published var isBusy: Bool = false
    @Published var message: String?

    // Sync mode UI binding: "single" | "perBook"
    @Published var syncMode: String = "single"
    @Published var appleBooksDbId: String = ""
    @Published var goodLinksDbId: String = ""
    
    private let notionConfig: NotionConfigStoreProtocol
    private let notionService: NotionServiceProtocol
    
    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService) {
        self.notionConfig = notionConfig
        self.notionService = notionService
        self.notionKeyInput = notionConfig.notionKey ?? ""
        self.notionPageIdInput = notionConfig.notionPageId ?? ""
        self.syncMode = notionConfig.syncMode ?? "single"
        // Load optional per-source DB IDs if present
        if let appleId = notionConfig.databaseIdForSource("appleBooks") {
            self.appleBooksDbId = appleId
        }
        if let goodId = notionConfig.databaseIdForSource("goodLinks") {
            self.goodLinksDbId = goodId
        }
    }
    
    func saveCredentials() {
        notionConfig.notionKey = notionKeyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        notionConfig.notionPageId = notionPageIdInput.trimmingCharacters(in: .whitespacesAndNewlines)
        // Persist optional per-source DB IDs (only if non-empty)
        let appleTrimmed = appleBooksDbId.trimmingCharacters(in: .whitespacesAndNewlines)
        if appleTrimmed.isEmpty {
            notionConfig.setDatabaseId(nil, forSource: "appleBooks")
        } else {
            notionConfig.setDatabaseId(appleTrimmed, forSource: "appleBooks")
        }
        let goodTrimmed = goodLinksDbId.trimmingCharacters(in: .whitespacesAndNewlines)
        if goodTrimmed.isEmpty {
            notionConfig.setDatabaseId(nil, forSource: "goodLinks")
        } else {
            notionConfig.setDatabaseId(goodTrimmed, forSource: "goodLinks")
        }
        // Provide immediate feedback to the UI
        message = "Credentials saved"
        // Clear feedback after 2 seconds
        Task {
            try? await Task.sleep(nanoseconds: 2 * 1_000_000_000)
            await MainActor.run {
                if message == "Credentials saved" {
                    message = nil
                }
            }
        }
    }

    func saveSyncMode() {
        let trimmed = syncMode.trimmingCharacters(in: .whitespacesAndNewlines)
        notionConfig.syncMode = trimmed.isEmpty ? "single" : trimmed
        message = "Sync mode saved: \(notionConfig.syncMode ?? "single")"
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await MainActor.run {
                if message?.starts(with: "Sync mode saved") == true {
                    message = nil
                }
            }
        }
    }
}
