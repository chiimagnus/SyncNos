import Foundation

@MainActor
final class NotionIntegrationViewModel: ObservableObject {
    @Published var notionKeyInput: String = ""
    @Published var notionPageIdInput: String = ""
    @Published var databaseTitleInput: String = "My Database"
    @Published var pageTitleInput: String = "My Page"
    @Published var headerTextInput: String = "Header"
    @Published var pageContentInput: String = "Hello from macOS app"
    
    @Published var createdDatabaseId: String?
    @Published var createdPageId: String?
    
    @Published var isBusy: Bool = false
    @Published var message: String?
    
    private let notionConfig: NotionConfigStoreProtocol
    private let notionService: NotionServiceProtocol
    
    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService) {
        self.notionConfig = notionConfig
        self.notionService = notionService
        self.notionKeyInput = notionConfig.notionKey ?? ""
        self.notionPageIdInput = notionConfig.notionPageId ?? ""
    }
    
    func saveCredentials() {
        notionConfig.notionKey = notionKeyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        notionConfig.notionPageId = notionPageIdInput.trimmingCharacters(in: .whitespacesAndNewlines)
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
    
    func createDatabase() async {
        await runWithBusy { [self] in
            let db = try await self.notionService.createDatabase(title: self.databaseTitleInput)
            self.createdDatabaseId = db.id
            self.message = "Database created: \(db.id)"
        }
    }
    
    func createPage() async {
        guard let databaseId = createdDatabaseId else {
            self.message = "Create a database first."
            return
        }
        await runWithBusy { [self] in
            let page = try await self.notionService.createPage(databaseId: databaseId, pageTitle: self.pageTitleInput, header: self.headerTextInput)
            self.createdPageId = page.id
            self.message = "Page created: \(page.id)"
        }
    }
    
    func appendContent() async {
        guard let pageId = createdPageId else {
            self.message = "Create a page first."
            return
        }
        await runWithBusy { [self] in
            _ = try await self.notionService.appendParagraph(pageId: pageId, content: self.pageContentInput)
            self.message = "Content appended!"
        }
    }
    
    private func runWithBusy(_ operation: @escaping () async throws -> Void) async {
        isBusy = true
        message = nil
        do {
            try await operation()
        } catch {
            self.message = error.localizedDescription
        }
        isBusy = false
    }
}


