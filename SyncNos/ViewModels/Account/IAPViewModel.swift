import Foundation
import StoreKit
import Combine

@MainActor
final class IAPViewModel: ObservableObject {
    // MARK: - Production Properties
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var isProUnlocked: Bool = DIContainer.shared.iapService.isProUnlocked
    @Published var hasPurchased: Bool = DIContainer.shared.iapService.hasPurchased
    @Published var purchaseType: PurchaseType = DIContainer.shared.iapService.purchaseType
    @Published var isInTrialPeriod: Bool = DIContainer.shared.iapService.isInTrialPeriod
    @Published var trialDaysRemaining: Int = DIContainer.shared.iapService.trialDaysRemaining
    @Published var expirationDate: Date?
    @Published var purchaseDate: Date?

#if DEBUG
    // MARK: - Debug Properties
    @Published var debugInfo: IAPDebugInfo?
#endif

    private let iap: IAPServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var cancellables: Set<AnyCancellable> = []

    init(iap: IAPServiceProtocol = DIContainer.shared.iapService) {
        self.iap = iap

        NotificationCenter.default
            .publisher(for: IAPService.statusChangedNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.updateStatus()
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Production Methods
    
    private func updateStatus() {
        isProUnlocked = iap.isProUnlocked
        hasPurchased = iap.hasPurchased
        purchaseType = iap.purchaseType
        isInTrialPeriod = iap.isInTrialPeriod
        trialDaysRemaining = iap.trialDaysRemaining
        
        Task {
            expirationDate = await iap.getAnnualSubscriptionExpirationDate()
            purchaseDate = await iap.getPurchaseDate()
        }
        
#if DEBUG
        refreshDebugInfo()
#endif
    }

    func onAppear() {
        updateStatus()
        Task { @MainActor [weak self] in
            await self?.refresh()
        }
    }

    func refresh() async {
        isLoading = true
        message = nil
        do {
            let list = try await iap.fetchProducts()
            products = list
            isLoading = false
        } catch {
            message = error.localizedDescription
            isLoading = false
        }
    }

    func buy(product: Product) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let ok = try await self.iap.purchase(product: product)
                if ok {
                    self.message = NSLocalizedString("Purchase successful.", comment: "")
                } else {
                    self.message = NSLocalizedString("Purchase cancelled or pending.", comment: "")
                }
            } catch {
                self.message = error.localizedDescription
            }
        }
    }

    func restore() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            let ok = await self.iap.restorePurchases()
            self.message = ok ? NSLocalizedString("Restored successfully.", comment: "") : NSLocalizedString("Restore failed.", comment: "")
        }
    }

#if DEBUG
    // MARK: - Debug Methods
    
    private func refreshDebugInfo() {
        debugInfo = iap.getDebugInfo()
    }

    func requestReset() {
        do {
            try iap.resetAllPurchaseData()
            logger.debug("IAP data reset successfully")
            refreshDebugInfo()
        } catch {
            logger.error("Reset failed: \(error.localizedDescription)")
        }
    }

    func simulateState(_ state: SimulatedPurchaseState) {
        do {
            try iap.simulatePurchaseState(state)
            logger.debug("IAP state simulated successfully")
            refreshDebugInfo()
        } catch {
            logger.error("Simulation failed: \(error.localizedDescription)")
        }
    }
#endif
}
