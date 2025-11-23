import Foundation
import StoreKit
import Combine

@MainActor
final class IAPViewModel: ObservableObject {
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var isProUnlocked: Bool = DIContainer.shared.iapService.isProUnlocked
    @Published var hasPurchased: Bool = DIContainer.shared.iapService.hasPurchased
    @Published var isInTrialPeriod: Bool = DIContainer.shared.iapService.isInTrialPeriod
    @Published var trialDaysRemaining: Int = DIContainer.shared.iapService.trialDaysRemaining

    private let iap: IAPServiceProtocol
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

    private func updateStatus() {
        isProUnlocked = iap.isProUnlocked
        hasPurchased = iap.hasPurchased
        isInTrialPeriod = iap.isInTrialPeriod
        trialDaysRemaining = iap.trialDaysRemaining
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
}
