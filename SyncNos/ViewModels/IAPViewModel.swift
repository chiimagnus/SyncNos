import Foundation
import StoreKit

@MainActor
final class IAPViewModel: ObservableObject {
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var message: String?
    @Published var isProUnlocked: Bool = DIContainer.shared.iapService.isProUnlocked

    private let iap: IAPServiceProtocol

    init(iap: IAPServiceProtocol = DIContainer.shared.iapService) {
        self.iap = iap
        NotificationCenter.default.addObserver(forName: IAPService.statusChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.isProUnlocked = DIContainer.shared.iapService.isProUnlocked
            }
        }
    }

    func onAppear() {
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
