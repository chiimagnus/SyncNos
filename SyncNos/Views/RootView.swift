import SwiftUI

/// 根视图：管理 Onboarding、PayWall、WhatsNew 和 MainListView 的切换
/// 确保 PayWall 在 MainListView 初始化之前显示，避免数据源的副作用（如文件夹授权弹窗）
struct RootView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding: Bool = false
    @State private var iapPresentationMode: IAPPresentationMode? = nil
    @State private var showWhatsNew: Bool = false
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    private var iapService: IAPServiceProtocol {
        DIContainer.shared.iapService
    }
    
    var body: some View {
        Group {
            if !hasCompletedOnboarding {
                // Step 1: Onboarding（未完成引导）
                OnboardingView()
                    .transition(.opacity)
            } else if let mode = iapPresentationMode {
                // Step 2: PayWall（需要显示付费墙）
                PayWallView(
                    presentationMode: mode,
                    onFinish: {
                        iapPresentationMode = nil
                        checkTrialStatus()
                    }
                )
                .transition(.opacity)
            } else if showWhatsNew {
                // Step 3: What's New（版本更新时显示）
                WhatsNewView(onFinish: {
                    withAnimation(.spring()) {
                        showWhatsNew = false
                    }
                })
                .transition(.opacity)
            } else {
                // Step 4: MainListView（正常使用）
                MainListView()
                    .transition(.opacity)
            }
        }
        .animation(.spring(), value: hasCompletedOnboarding)
        .animation(.spring(), value: iapPresentationMode != nil)
        .animation(.spring(), value: showWhatsNew)
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
        // 应用字体缩放到整个视图层级
        .applyFontScale()
    }
    
    // MARK: - Trial Status Check
    
    private func checkTrialStatus() {
        let logger = DIContainer.shared.loggerService
        logger.debug("checkTrialStatus called: hasPurchased=\(iapService.hasPurchased), hasEverPurchasedAnnual=\(iapService.hasEverPurchasedAnnual), isProUnlocked=\(iapService.isProUnlocked), hasShownWelcome=\(iapService.hasShownWelcome), trialDaysRemaining=\(iapService.trialDaysRemaining)")
        
        // Priority 1: 如果已购买，不显示任何付费墙
        if iapService.hasPurchased {
            logger.debug("User has purchased, hiding paywall")
            iapPresentationMode = nil
            checkWhatsNew()
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
        
        // 其他情况不显示付费墙，检查 What's New
        logger.debug("No paywall needed, hiding")
        iapPresentationMode = nil
        checkWhatsNew()
    }
    
    // MARK: - What's New Check
    
    private func checkWhatsNew() {
        // 只在 PayWall 不显示时检查 What's New
        guard iapPresentationMode == nil else { return }
        
        if WhatsNewViewModel.shouldShowWhatsNew() {
            let logger = DIContainer.shared.loggerService
            logger.info("[WhatsNew] New version detected, showing What's New")
            showWhatsNew = true
        }
    }
}

#Preview("RootView") {
    RootView()
}
