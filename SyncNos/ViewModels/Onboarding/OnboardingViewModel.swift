import SwiftUI
import Combine

@MainActor
final class OnboardingViewModel: ObservableObject {
    // MARK: - Steps Enum
    enum OnboardingStep: Int, CaseIterable {
        case welcome = 0
        case connectNotion
        case enableSources
    }
    
    // MARK: - Published Properties
    @Published var currentStep: OnboardingStep = .welcome
    
    // Source Toggles (datasource visibility, independent from Auto Sync)
    // 默认：仅启用 Apple Books，其余数据源关闭
    @AppStorage("datasource.appleBooks.enabled") var appleBooksEnabled: Bool = true
    @AppStorage("datasource.goodLinks.enabled") var goodLinksEnabled: Bool = false
    @AppStorage("datasource.weRead.enabled") var weReadEnabled: Bool = false
    
    // Notion State
    @Published var isNotionConnected: Bool = false
    @Published var workspaceName: String?
    @Published var isAuthorizingNotion: Bool = false
    @Published var notionErrorMessage: String?
    
    // WeRead State
    @Published var isWeReadLoggedIn: Bool = false
    @Published var sourceSelectionError: String?
    
    // Pro Access
    @Published var isProUnlocked: Bool = false // To track purchase status if needed
    
    // MARK: - Dependencies
    private let notionConfig: NotionConfigStoreProtocol
    private let notionOAuthService: NotionOAuthService
    private let iapService: IAPServiceProtocol
    private let weReadAuthService: WeReadAuthServiceProtocol
    
    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        notionOAuthService: NotionOAuthService = DIContainer.shared.notionOAuthService,
        iapService: IAPServiceProtocol = DIContainer.shared.iapService,
        weReadAuthService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService
    ) {
        self.notionConfig = notionConfig
        self.notionOAuthService = notionOAuthService
        self.iapService = iapService
        self.weReadAuthService = weReadAuthService
        
        // Initialize states
        self.checkNotionStatus()
        self.checkWeReadStatus()
        
        // Observe IAP status
        self.isProUnlocked = iapService.isProUnlocked
    }
    
    // MARK: - Actions
    
    func nextStep() {
        if currentStep == .enableSources {
            guard appleBooksEnabled || goodLinksEnabled || weReadEnabled else {
                sourceSelectionError = "Please open at least one synchronization source"
                return
            }
            sourceSelectionError = nil
        }
        
        if let next = OnboardingStep(rawValue: currentStep.rawValue + 1) {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                currentStep = next
            }
        } else {
            completeOnboarding()
        }
    }
    
    func connectNotion() {
        guard !isAuthorizingNotion else { return }
        isAuthorizingNotion = true
        notionErrorMessage = nil
        
        Task {
            do {
                let response = try await notionOAuthService.performFullAuthorization()
                
                // Save credentials
                notionConfig.notionOAuthToken = response.accessToken
                notionConfig.notionWorkspaceId = response.workspaceId
                notionConfig.notionWorkspaceName = response.workspaceName
                
                await MainActor.run {
                    self.checkNotionStatus()
                    self.isAuthorizingNotion = false
                    // Optional: Auto advance or let user click next
                }
            } catch {
                await MainActor.run {
                    self.notionErrorMessage = error.localizedDescription
                    self.isAuthorizingNotion = false
                }
            }
        }
    }
    
    func checkNotionStatus() {
        if let _ = notionConfig.notionOAuthToken {
            isNotionConnected = true
            workspaceName = notionConfig.notionWorkspaceName
        } else {
            isNotionConnected = false
            workspaceName = nil
        }
    }
    
    func checkWeReadStatus() {
        isWeReadLoggedIn = weReadAuthService.isLoggedIn
    }
    
    func completeOnboarding() {
        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
        // Trigger app refresh or state change handled in App wrapper
    }
    
    func skipTrial() {
        completeOnboarding()
    }
}

