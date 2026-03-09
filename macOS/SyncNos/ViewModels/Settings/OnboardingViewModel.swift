import SwiftUI  // 需要 SwiftUI 用于 @AppStorage 和 withAnimation
import Combine

// MARK: - OnboardingViewModel
/// 管理 Onboarding 流程的 ViewModel
///
/// 注意：此 ViewModel 使用了 SwiftUI 的以下特性：
/// - @AppStorage：简化用户偏好设置的管理
/// - withAnimation：步骤切换动画（理想情况下应移至 View 层，但为简化代码暂时保留）
/// 虽然理想情况下 ViewModel 不应依赖 SwiftUI，但这些是 SwiftUI 生态中被广泛接受的实践。
@MainActor
final class OnboardingViewModel: ObservableObject {
    // MARK: - Steps Enum
    enum OnboardingStep: Int, CaseIterable {
        case welcome = 0
        case connectNotion
        case enableSources
        case touchMe
    }
    
    // MARK: - Published Properties
    @Published var currentStep: OnboardingStep = .welcome
    
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
    private let siteLoginsStore: SiteLoginsStoreProtocol
    
    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        notionOAuthService: NotionOAuthService = DIContainer.shared.notionOAuthService,
        iapService: IAPServiceProtocol = DIContainer.shared.iapService,
        siteLoginsStore: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore
    ) {
        self.notionConfig = notionConfig
        self.notionOAuthService = notionOAuthService
        self.iapService = iapService
        self.siteLoginsStore = siteLoginsStore
        
        // Initialize states
        self.checkNotionStatus()
        self.checkWeReadStatus()
        
        // Observe IAP status
        self.isProUnlocked = iapService.isProUnlocked
    }
    
    // MARK: - Actions
    
    func nextStep() {
        if currentStep == .enableSources {
            guard hasAtLeastOneEnabledSource else {
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
        Task {
            let cookie = await siteLoginsStore.getCookieHeader(for: "https://weread.qq.com/")
            await MainActor.run {
                self.isWeReadLoggedIn = (cookie?.isEmpty == false)
            }
        }
    }
    
    func completeOnboarding() {
        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
        // Trigger app refresh or state change handled in App wrapper
    }
    
    func skipTrial() {
        completeOnboarding()
    }

    // MARK: - Data Sources (Onboarding)

    var onboardingProviders: [any DataSourceUIProvider] {
        DataSourceRegistry.shared.allProviders
    }

    func isSourceEnabled(_ provider: any DataSourceUIProvider) -> Bool {
        (UserDefaults.standard.object(forKey: provider.enabledStorageKey) as? Bool) ?? provider.defaultEnabled
    }

    func setSourceEnabled(_ provider: any DataSourceUIProvider, _ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: provider.enabledStorageKey)
    }

    func enabledBinding(for provider: any DataSourceUIProvider) -> Binding<Bool> {
        Binding(
            get: { [weak self] in
                guard let self else { return provider.defaultEnabled }
                return self.isSourceEnabled(provider)
            },
            set: { [weak self] newValue in
                self?.setSourceEnabled(provider, newValue)
            }
        )
    }

    private var hasAtLeastOneEnabledSource: Bool {
        onboardingProviders.contains { isSourceEnabled($0) }
    }
}
