import Foundation
import StoreKit
import Combine

/// 试用期/付费墙的展示模式
enum TrialPresentationMode: Equatable {
    case onboarding                         // Onboarding 第四步（新用户）
    case trialReminder(daysRemaining: Int)  // 试用期提醒（7/3/1天）
    case trialExpired                       // 试用期已过期
    case subscriptionExpired                // 年订阅已过期
}

/// 试用期/付费墙视图的 ViewModel
/// 统一管理 IAP 状态和 paywall 显示逻辑
@MainActor
final class TrialViewModel: ObservableObject {
    // MARK: - Published Properties
    
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var isProUnlocked: Bool = false
    @Published var hasPurchased: Bool = false
    @Published var loadingProductID: String? = nil
    
    /// 当前应该显示的 paywall 模式（nil 表示不需要显示）
    @Published var requiredPresentationMode: TrialPresentationMode? = nil
    
    // MARK: - Dependencies
    
    private let iapService: IAPServiceProtocol
    private let logger: LoggerServiceProtocol
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    init(
        iapService: IAPServiceProtocol = DIContainer.shared.iapService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.iapService = iapService
        self.logger = logger
        
        // 初始化状态
        self.isProUnlocked = iapService.isProUnlocked
        self.hasPurchased = iapService.hasPurchased
        
        // 监听 IAP 状态变化
        NotificationCenter.default
            .publisher(for: IAPService.statusChangedNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateStatus()
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Paywall Logic
    
    /// 检查并更新是否需要显示 paywall
    /// 返回当前应该显示的模式（nil 表示不需要显示）
    func checkPaywallRequired() -> TrialPresentationMode? {
        logger.debug("checkPaywallRequired: hasPurchased=\(iapService.hasPurchased), hasEverPurchasedAnnual=\(iapService.hasEverPurchasedAnnual), isProUnlocked=\(iapService.isProUnlocked), hasShownWelcome=\(iapService.hasShownWelcome), trialDaysRemaining=\(iapService.trialDaysRemaining)")
        
        // Priority 1: 如果已购买，不显示任何付费墙
        if iapService.hasPurchased {
            logger.debug("User has purchased, no paywall needed")
            requiredPresentationMode = nil
            return nil
        }
        
        // Priority 2: 如果曾经购买过年订阅但已过期
        if iapService.hasEverPurchasedAnnual {
            logger.debug("Annual subscription expired")
            requiredPresentationMode = .subscriptionExpired
            return .subscriptionExpired
        }
        
        // Priority 3: 如果试用期过期
        if !iapService.isProUnlocked {
            logger.debug("Trial expired")
            requiredPresentationMode = .trialExpired
            return .trialExpired
        }
        
        // Priority 4: 如果应该显示试用提醒（7/3/1天）
        if iapService.shouldShowTrialReminder() {
            let days = iapService.trialDaysRemaining
            logger.debug("Should show trial reminder: \(days) days remaining")
            requiredPresentationMode = .trialReminder(daysRemaining: days)
            return .trialReminder(daysRemaining: days)
        }
        
        // 其他情况不显示付费墙
        logger.debug("No paywall needed")
        requiredPresentationMode = nil
        return nil
    }
    
    /// 用于 Onboarding 流程：获取当前应该显示的模式
    /// 与 checkPaywallRequired 类似，但新用户返回 .onboarding 而不是 nil
    func getOnboardingPresentationMode() -> TrialPresentationMode {
        // 如果已购买，仍然显示 onboarding（会显示购买成功状态）
        if iapService.hasPurchased {
            return .onboarding
        }
        
        // 如果曾经购买过年订阅但已过期
        if iapService.hasEverPurchasedAnnual {
            return .subscriptionExpired
        }
        
        // 如果试用期过期
        if !iapService.isProUnlocked {
            return .trialExpired
        }
        
        // 如果应该显示试用提醒（7/3/1天）
        if iapService.shouldShowTrialReminder() {
            return .trialReminder(daysRemaining: iapService.trialDaysRemaining)
        }
        
        // 新用户或试用期内正常状态
        return .onboarding
    }
    
    /// 完成 paywall 流程后调用（标记提醒已显示等）
    func dismissPaywall() {
        // 标记提醒已显示，避免重复触发
        iapService.markReminderShown()
        requiredPresentationMode = nil
    }
    
    // MARK: - Public Methods
    
    func onAppear() {
        updateStatus()
        Task {
            await loadProducts()
        }
    }
    
    func buyProduct(_ product: Product) {
        loadingProductID = product.id
        
        Task {
            do {
                let success = try await iapService.purchase(product: product)
                if success {
                    message = NSLocalizedString("Purchase successful.", comment: "")
                } else {
                    message = NSLocalizedString("Purchase cancelled or pending.", comment: "")
                }
            } catch {
                message = error.localizedDescription
            }
            
            // 延迟清除加载状态，确保 UI 更新完成
            try? await Task.sleep(nanoseconds: 500_000_000)
            loadingProductID = nil
        }
    }
    
    func restorePurchases() {
        Task {
            let success = await iapService.restorePurchases()
            message = success
                ? NSLocalizedString("Restored successfully.", comment: "")
                : NSLocalizedString("Restore failed.", comment: "")
        }
    }
    
    /// 标记欢迎页已显示（开始试用）
    func markWelcomeShown() {
        iapService.markWelcomeShown()
    }
    
    /// 标记提醒已显示
    func markReminderShown() {
        iapService.markReminderShown()
    }
    
    // MARK: - Private Methods
    
    private func loadProducts() async {
        isLoading = true
        message = nil
        
        do {
            products = try await iapService.fetchProducts()
        } catch {
            message = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func updateStatus() {
        isProUnlocked = iapService.isProUnlocked
        hasPurchased = iapService.hasPurchased
    }
}

// MARK: - Computed Properties for UI

extension TrialViewModel {
    
    /// 获取头部图标名称
    func headerIconName(for mode: TrialPresentationMode) -> String {
        switch mode {
        case .onboarding:
            return "gift.fill"
        case .trialReminder(let days):
            switch days {
            case 7: return "clock.badge.exclamationmark"
            case 3: return "exclamationmark.triangle.fill"
            case 1: return "exclamationmark.circle.fill"
            default: return "clock"
            }
        case .trialExpired:
            return "face.dashed.fill"  // 虚线脸，表示试用期结束
        case .subscriptionExpired:
            return "exclamationmark.circle.fill"
        }
    }
    
    /// 获取头部图标颜色
    func headerIconColorName(for mode: TrialPresentationMode) -> String {
        switch mode {
        case .onboarding:
            return "green"
        case .trialReminder(let days):
            switch days {
            case 7: return "blue"
            case 3: return "orange"
            case 1: return "red"
            default: return "secondary"
            }
        case .trialExpired:
            return "gray"  // 悲伤的灰色
        case .subscriptionExpired:
            return "red"
        }
    }
    
    /// 获取标题
    func headerTitle(for mode: TrialPresentationMode) -> String {
        // 如果已购买，显示购买成功标题
        if hasPurchased {
            return "Purchase Successful!"
        }
        
        switch mode {
        case .onboarding:
            return "Start Your Free Trial"
        case .trialReminder(let days):
            switch days {
            case 7: return "Trial Ending Soon"
            case 3: return "Only 3 Days Left"
            case 1: return "Last Day of Trial"
            default: return "Trial Reminder"
            }
        case .trialExpired:
            return "Trial Period Ended"
        case .subscriptionExpired:
            return "Subscription Expired"
        }
    }
    
    /// 获取描述信息
    func headerMessage(for mode: TrialPresentationMode) -> String {
        // 如果已购买，显示购买成功消息
        if hasPurchased {
            return "Thank you for your support! Click the arrow to continue."
        }
        
        switch mode {
        case .onboarding:
            return "30 days free, then choose a plan to continue syncing."
        case .trialReminder(let days):
            return "Your free trial will expire in \(days) day\(days == 1 ? "" : "s"). Purchase now to continue enjoying unlimited syncing."
        case .trialExpired:
            return "Your 30-day free trial has expired. Purchase to continue using SyncNos."
        case .subscriptionExpired:
            return "Your annual subscription has expired. Renew now to continue syncing your highlights."
        }
    }
}

