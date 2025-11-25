import Foundation
import StoreKit
import Combine

/// 试用期/付费墙的展示模式
enum TrialPresentationMode: Equatable {
    case onboarding                         // Onboarding 第四步（嵌入式）
    case trialReminder(daysRemaining: Int)  // 试用期提醒（7/3/1天）
    case trialExpired                       // 试用期已过期
    case subscriptionExpired                // 年订阅已过期
}

/// 试用期/付费墙视图的 ViewModel
@MainActor
final class TrialViewModel: ObservableObject {
    // MARK: - Published Properties
    
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var isProUnlocked: Bool = false
    @Published var hasPurchased: Bool = false
    @Published var loadingProductID: String? = nil
    
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
            return "star.circle.fill"
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
            return "yellow"
        case .subscriptionExpired:
            return "red"
        }
    }
    
    /// 获取标题
    func headerTitle(for mode: TrialPresentationMode) -> String {
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

