import Foundation

@MainActor
final class NotionIntegrationViewModel: ObservableObject {
    @Published var notionKeyInput: String = ""
    @Published var notionPageIdInput: String = ""
    
    @Published var isBusy: Bool = false
    @Published var message: String?
    @Published var errorMessage: String?

    // Sync mode UI binding: "single" | "perBook"
    @Published var syncMode: String = "single"
    // Per-source DB IDs moved to per-source settings view models; keep read-only copies for display
    @Published var appleBooksDbId: String = ""
    @Published var goodLinksDbId: String = ""
    
    // OAuth 相关状态
    @Published var isOAuthAuthorized: Bool = false
    @Published var workspaceName: String?
    @Published var isAuthorizing: Bool = false
    // Page picking
    @Published var isPagePickerPresented: Bool = false
    @Published var availablePages: [NotionPageSummary] = []
    @Published var pageSearchText: String = ""
    
    private let notionConfig: NotionConfigStoreProtocol
    private let notionService: NotionServiceProtocol
    private let oauthService: NotionOAuthService
    
    init(notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         oauthService: NotionOAuthService = DIContainer.shared.notionOAuthService) {
        self.notionConfig = notionConfig
        self.notionService = notionService
        self.oauthService = oauthService
        self.notionKeyInput = notionConfig.notionKey ?? ""
        self.notionPageIdInput = notionConfig.notionPageId ?? ""
        self.syncMode = notionConfig.syncMode ?? "single"
        // Load optional per-source DB IDs (read-only display)
        self.appleBooksDbId = notionConfig.databaseIdForSource("appleBooks") ?? ""
        self.goodLinksDbId = notionConfig.databaseIdForSource("goodLinks") ?? ""
        // 检查 OAuth 授权状态
        self.isOAuthAuthorized = notionConfig.notionOAuthToken != nil
        self.workspaceName = notionConfig.notionWorkspaceName
    }
    
    func saveCredentials() {
        notionConfig.notionKey = notionKeyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        notionConfig.notionPageId = notionPageIdInput.trimmingCharacters(in: .whitespacesAndNewlines)
        // Per-source DB IDs are managed in their respective settings pages
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
    
    /// 启动 OAuth 授权流程
    func authorizeWithOAuth() {
        guard !isAuthorizing else { return }
        
        isAuthorizing = true
        errorMessage = nil
        message = nil
        
        Task {
            do {
                let tokenResponse = try await oauthService.performFullAuthorization()
                
                // 保存 OAuth token 和 workspace 信息
                await MainActor.run {
                    self.notionConfig.notionOAuthToken = tokenResponse.accessToken
                    self.notionConfig.notionWorkspaceId = tokenResponse.workspaceId
                    self.notionConfig.notionWorkspaceName = tokenResponse.workspaceName
                    
                    self.isOAuthAuthorized = true
                    self.workspaceName = tokenResponse.workspaceName
                    self.message = tokenResponse.workspaceName.map { "Authorized workspace: \($0)" } ?? "Authorization successful"
                    
                    // 如果用户还没有设置 pageId，尝试获取用户可访问的页面列表
                    // 注意：这需要额外的 API 调用，暂时先提示用户手动设置
                    if self.notionConfig.notionPageId == nil {
                        self.message = (self.message ?? "") + "\nPlease select a page ID from your Notion workspace"
                    }
                }
                
                // 清除消息
                try? await Task.sleep(nanoseconds: 3 * 1_000_000_000)
                await MainActor.run {
                    if self.message?.contains("Authorized") == true {
                        self.message = nil
                    }
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isOAuthAuthorized = false
                }
            }
            
            await MainActor.run {
                self.isAuthorizing = false
            }
        }
    }
    
    /// 撤销 OAuth 授权
    func revokeOAuth() {
        notionConfig.notionOAuthToken = nil
        notionConfig.notionWorkspaceId = nil
        notionConfig.notionWorkspaceName = nil
        isOAuthAuthorized = false
        workspaceName = nil
        message = "OAuth authorization revoked"
        
        Task {
            try? await Task.sleep(nanoseconds: 2 * 1_000_000_000)
            await MainActor.run {
                if message == "OAuth authorization revoked" {
                    message = nil
                }
            }
        }
    }

    // MARK: - Page selection
    func openPagePicker() {
        guard isOAuthAuthorized || !(notionConfig.effectiveToken ?? "").isEmpty else {
            errorMessage = "Please authorize with Notion first"
            return
        }
        isBusy = true
        errorMessage = nil
        message = nil
        Task {
            do {
                let pages = try await notionService.listAccessibleParentPages(searchQuery: nil)
                await MainActor.run {
                    self.availablePages = pages
                    self.isPagePickerPresented = true
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                }
            }
            await MainActor.run { self.isBusy = false }
        }
    }

    func selectPage(_ page: NotionPageSummary) {
        notionConfig.notionPageId = page.id
        notionPageIdInput = page.id
        isPagePickerPresented = false
        message = "Selected page: \(page.iconEmoji ?? "") \(page.title)"
        // Auto-clear tip
        Task {
            try? await Task.sleep(nanoseconds: 2 * 1_000_000_000)
            await MainActor.run { if self.message?.hasPrefix("Selected page:") == true { self.message = nil } }
        }
    }
}
