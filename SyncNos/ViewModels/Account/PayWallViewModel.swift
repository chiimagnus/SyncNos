import Foundation
import StoreKit
import Combine

/// 付费墙的展示模式
enum TrialPresentationMode: Equatable {
    case welcome                            // 首次启动欢迎页（开始试用）
    case trialReminder(daysRemaining: Int)  // 试用期提醒（7/3/1天）
    case trialExpired                       // 试用期已过期
    case subscriptionExpired                // 年订阅已过期
}

/// 付费墙视图的 ViewModel
/// 统一管理 IAP 状态和 paywall 显示逻辑
@MainActor
final class PayWallViewModel: ObservableObject {
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
        
        // Priority 4: 如果还没有显示过欢迎页（新用户首次启动）
        if !iapService.hasShownWelcome {
            logger.debug("New user, showing welcome")
            requiredPresentationMode = .welcome
            return .welcome
        }
        
        // Priority 5: 如果应该显示试用提醒（7/3/1天）
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
    
    /// 完成 paywall 流程后调用（标记提醒/欢迎页已显示等）
    func dismissPaywall() {
        // 如果是欢迎模式，标记欢迎页已显示
        if requiredPresentationMode == .welcome {
            iapService.markWelcomeShown()
        }
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
