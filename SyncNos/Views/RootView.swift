import SwiftUI

/// 根视图：管理 Onboarding、PayWall 和 MainListView 的切换
/// 确保 PayWall 在 MainListView 初始化之前显示，避免数据源的副作用（如文件夹授权弹窗）
struct RootView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding: Bool = false
    @State private var iapPresentationMode: IAPPresentationMode? = nil
    
    private var iapService: IAPServiceProtocol {
        DIContainer.shared.iapService
    }
    
    /// 当前应该显示的视图阶段
    private enum ViewPhase: Equatable {
        case onboarding
        case paywall(IAPPresentationMode)
        case main
    }
    
    private var currentPhase: ViewPhase {
        if !hasCompletedOnboarding {
            return .onboarding
        } else if let mode = iapPresentationMode {
            return .paywall(mode)
        } else {
            return .main
        }
    }
    
    var body: some View {
        // 使用 switch 而不是 if-else，确保只有当前阶段的视图被创建
        // 这样可以避免 MainListView 在 PayWall 显示时被预先初始化
        ZStack {
            switch currentPhase {
            case .onboarding:
                OnboardingView()
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            case .paywall(let mode):
                PayWallView(
                    presentationMode: mode,
                    onFinish: {
                        iapPresentationMode = nil
                        checkTrialStatus()
                    }
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            case .main:
                MainListView()
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            }
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: currentPhase)
        .onAppear {
            // 只有在完成引导后才检查 PayWall 状态
            if hasCompletedOnboarding {
                checkTrialStatus()
            }
        }
        .onChange(of: hasCompletedOnboarding) { _, newValue in
            // 完成引导后立即检查 PayWall 状态
            if newValue {
                checkTrialStatus()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: IAPService.statusChangedNotification)) { _ in
            if hasCompletedOnboarding {
                let logger = DIContainer.shared.loggerService
                logger.debug("IAP status changed notification received, rechecking trial status")
                checkTrialStatus()
            }
        }
    }
    
    // MARK: - Trial Status Check
    
    private func checkTrialStatus() {
        let logger = DIContainer.shared.loggerService
        logger.debug("checkTrialStatus called: hasPurchased=\(iapService.hasPurchased), hasEverPurchasedAnnual=\(iapService.hasEverPurchasedAnnual), isProUnlocked=\(iapService.isProUnlocked), hasShownWelcome=\(iapService.hasShownWelcome), trialDaysRemaining=\(iapService.trialDaysRemaining)")
        
        // Priority 1: 如果已购买，不显示任何付费墙
        if iapService.hasPurchased {
            logger.debug("User has purchased, hiding paywall")
            iapPresentationMode = nil
            return
        }
        
        // Priority 2: 如果曾经购买过年订阅但已过期，显示订阅过期视图
        if iapService.hasEverPurchasedAnnual && !iapService.hasPurchased {
            logger.debug("Annual subscription expired, showing subscriptionExpired view")
            iapPresentationMode = .subscriptionExpired
            return
        }
        
        // Priority 3: 如果试用期过期且从未购买，显示试用期过期视图
        if !iapService.isProUnlocked {
            logger.debug("Trial expired, showing trialExpired view")
            iapPresentationMode = .trialExpired
            return
        }
        
        // Priority 4: 如果应该显示试用提醒，显示提醒视图
        if iapService.shouldShowTrialReminder() {
            logger.debug("Should show trial reminder, showing trialReminder view")
            iapPresentationMode = .trialReminder(daysRemaining: iapService.trialDaysRemaining)
            return
        }
        
        // Priority 5: 如果是首次使用且在试用期内，显示欢迎视图
        if !iapService.hasShownWelcome {
            logger.debug("First time user, showing welcome view")
            iapPresentationMode = .welcome
            return
        }
        
        // 其他情况不显示付费墙
        logger.debug("No paywall needed, hiding")
        iapPresentationMode = nil
    }
}

#Preview("RootView") {
    RootView()
}

