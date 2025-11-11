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
        
        // 获取 logger 用于记录日志
        let logger = DIContainer.shared.loggerService
        logger.info("🚀 Starting Notion OAuth authorization flow...")
        
        Task {
            do {
                logger.info("Step 1: Starting authorization...")
                let tokenResponse = try await oauthService.performFullAuthorization()
                
                logger.info("Step 2: Authorization successful, saving token and workspace info...")
                
                // 保存 OAuth token 和 workspace 信息
                await MainActor.run {
                    self.notionConfig.notionOAuthToken = tokenResponse.accessToken
                    self.notionConfig.notionWorkspaceId = tokenResponse.workspaceId
                    self.notionConfig.notionWorkspaceName = tokenResponse.workspaceName
                    
                    self.isOAuthAuthorized = true
                    self.workspaceName = tokenResponse.workspaceName
                    
                    let workspaceInfo = tokenResponse.workspaceName.map { "\($0)" } ?? "Unknown workspace"
                    self.message = "✅ Authorization successful!\nWorkspace: \(workspaceInfo)"
                    
                    logger.info("✅ OAuth token saved successfully for workspace: \(workspaceInfo)")
                    
                    // 如果用户还没有设置 pageId，提示用户手动设置
                    if self.notionConfig.notionPageId == nil {
                        self.message = (self.message ?? "") + "\n\n⚠️ Please enter a Page ID below to complete setup."
                        logger.warning("Page ID not set yet, user needs to enter it manually")
                    } else {
                        logger.info("✅ Page ID already configured: \(self.notionConfig.notionPageId ?? "unknown")")
                    }
                }
                
                // 清除消息（延迟更长时间以便用户看到）
                try? await Task.sleep(nanoseconds: 5 * 1_000_000_000)
                await MainActor.run {
                    if self.message?.contains("Authorization successful") == true {
                        self.message = nil
                    }
                }
            } catch {
                let errorMsg = error.localizedDescription
                logger.error("❌ OAuth authorization failed: \(errorMsg)")
                await MainActor.run {
                    self.errorMessage = "Authorization failed: \(errorMsg)"
                    self.isOAuthAuthorized = false
                }
            }
            
            await MainActor.run {
                self.isAuthorizing = false
                logger.info("OAuth authorization flow completed")
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
}
