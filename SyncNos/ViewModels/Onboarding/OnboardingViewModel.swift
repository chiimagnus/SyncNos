import SwiftUI
import Combine

@MainActor
final class OnboardingViewModel: ObservableObject {
    // MARK: - Steps Enum
    enum OnboardingStep: Int, CaseIterable {
        case welcome = 0
        case connectNotion
        case enableSources
        case proAccess
    }
    
    // MARK: - Published Properties
    @Published var currentStep: OnboardingStep = .welcome
    
    // Source Toggles (Sync with UserDefaults)
    @AppStorage("autoSync.appleBooks") var appleBooksEnabled: Bool = false
    @AppStorage("autoSync.goodLinks") var goodLinksEnabled: Bool = false
    @AppStorage("autoSync.weRead") var weReadEnabled: Bool = false
    
    // Notion State
    @Published var isNotionConnected: Bool = false
    @Published var workspaceName: String?
    @Published var isAuthorizingNotion: Bool = false
    @Published var notionErrorMessage: String?
    
    // Apple Books Permissions
    @Published var appleBooksPath: String?
    
    // WeRead State
    @Published var isWeReadLoggedIn: Bool = false
    
    // Pro Access
    @Published var isProUnlocked: Bool = false // To track purchase status if needed
    
    // MARK: - Dependencies
    private let notionConfig: NotionConfigStoreProtocol
    private let notionOAuthService: NotionOAuthService
    private let iapService: IAPServiceProtocol
    private let weReadAuthService: WeReadAuthServiceProtocol
    private let environmentDetector: EnvironmentDetectorProtocol
    
    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        notionOAuthService: NotionOAuthService = DIContainer.shared.notionOAuthService,
        iapService: IAPServiceProtocol = DIContainer.shared.iapService,
        weReadAuthService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        environmentDetector: EnvironmentDetectorProtocol = DIContainer.shared.environmentDetector
    ) {
        self.notionConfig = notionConfig
        self.notionOAuthService = notionOAuthService
        self.iapService = iapService
        self.weReadAuthService = weReadAuthService
        self.environmentDetector = environmentDetector
        
        // Initialize states
        self.checkNotionStatus()
        self.checkWeReadStatus()
        
        // Listen for Apple Books path selection
        NotificationCenter.default.addObserver(
            forName: Notification.Name("AppleBooksContainerSelected"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let path = notification.object as? String {
                Task { @MainActor in
                    self?.appleBooksPath = path
                }
                // If user just enabled it and selected path, we keep it enabled.
            }
        }
        
        // Observe IAP status
        self.isProUnlocked = iapService.isProUnlocked

        // 开发环境下：直接跳转到 Pro Access 步骤，方便每次启动调试 OnboardingProView
        if environmentDetector.isDevEnvironment() {
            self.currentStep = .proAccess
        }
    }
    
    // MARK: - Actions
    
    func nextStep() {
        if currentStep == .enableSources {
            // Check if any source enabled but not configured?
            // Ideally we prompt them during the toggle action, but here we just proceed.
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
    
    func requestAppleBooksAccess() {
        AppleBooksPicker.pickAppleBooksContainer()
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

