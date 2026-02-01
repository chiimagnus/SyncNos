import AppKit
import SwiftUI

/// 根视图：管理 Onboarding、PayWall 和 MainListView 的切换
/// 确保 PayWall 在 MainListView 初始化之前显示，避免数据源的副作用（如文件夹授权弹窗）
struct RootView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding: Bool = false
    @State private var iapPresentationMode: IAPPresentationMode? = nil
    @State private var mainWindow: NSWindow? = nil
    @State private var mainWindowBackup: MainWindowBackup? = nil
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    private var iapService: IAPServiceProtocol {
        DIContainer.shared.iapService
    }

    private var shouldLockMainWindowSize: Bool {
        !hasCompletedOnboarding || iapPresentationMode != nil
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
            } else {
                // Step 3: MainListView（正常使用）
                MainListView()
                    .transition(.opacity)
            }
        }
        // 标记“主窗口场景”上下文：用于按窗口禁用/启用快捷键（类似 VSCode when）
        .focusedSceneValue(\.isMainWindowSceneActive, true)
        .animation(.spring(), value: hasCompletedOnboarding)
        .animation(.spring(), value: iapPresentationMode != nil)
        .onAppear {
            updateMainWindowSizeModeIfPossible()
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
            updateMainWindowSizeModeIfPossible()
        }
        .onChange(of: iapPresentationMode) { _, _ in
            updateMainWindowSizeModeIfPossible()
        }
        .onChange(of: fontScaleManager.scaleLevel) { _, _ in
            updateMainWindowSizeModeIfPossible()
        }
        .onReceive(NotificationCenter.default.publisher(for: .iapServiceStatusChanged)) { _ in
            if hasCompletedOnboarding {
                let logger = DIContainer.shared.loggerService
                logger.debug("IAP status changed notification received, rechecking trial status")
                checkTrialStatus()
            }
        }
        .onChange(of: mainWindow) { _, _ in
            updateMainWindowSizeModeIfPossible()
        }
        // 应用字体缩放到整个视图层级
        .applyFontScale()
        .background(WindowReader(window: $mainWindow))
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

    // MARK: - Main Window Size Control

    private struct MainWindowBackup: Equatable {
        let frame: NSRect
        let minSize: NSSize
        let maxSize: NSSize
        let isResizable: Bool
    }

    /// Onboarding / PayWall 采用固定内容尺寸（避免出现“可随意拉伸窗口但 UI 固定居中”的体验）
    private var fixedContentSize: NSSize {
        switch fontScaleManager.scaleLevel {
        case .extraSmall, .small, .medium:
            return NSSize(width: 600, height: 500)
        case .large:
            return NSSize(width: 640, height: 540)
        case .extraLarge:
            return NSSize(width: 700, height: 580)
        case .accessibility1:
            return NSSize(width: 780, height: 650)
        case .accessibility2:
            return NSSize(width: 860, height: 720)
        }
    }

    private func updateMainWindowSizeModeIfPossible() {
        guard let window = mainWindow else { return }
        if shouldLockMainWindowSize {
            lockMainWindowToFixedContentSizeIfNeeded(window)
        } else {
            restoreMainWindowResizabilityIfNeeded(window)
        }
    }

    private func lockMainWindowToFixedContentSizeIfNeeded(_ window: NSWindow) {
        if mainWindowBackup == nil {
            mainWindowBackup = MainWindowBackup(
                frame: window.frame,
                minSize: window.minSize,
                maxSize: window.maxSize,
                isResizable: window.styleMask.contains(.resizable)
            )
        }

        // 关键：窗口是否可拖拽改变尺寸由 NSWindow 决定，View 的 .frame(width:height:) 只影响内容布局。
        window.setContentSize(fixedContentSize)
        window.minSize = fixedContentSize
        window.maxSize = fixedContentSize
        window.styleMask.remove(.resizable)
    }

    private func restoreMainWindowResizabilityIfNeeded(_ window: NSWindow) {
        guard let backup = mainWindowBackup else { return }

        window.minSize = backup.minSize
        window.maxSize = backup.maxSize
        if backup.isResizable {
            window.styleMask.insert(.resizable)
        } else {
            window.styleMask.remove(.resizable)
        }
        window.setFrame(backup.frame, display: true, animate: false)

        mainWindowBackup = nil
    }
}

#Preview("RootView") {
    RootView()
}
