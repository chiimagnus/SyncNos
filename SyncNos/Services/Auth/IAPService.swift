import Foundation
import StoreKit

// MARK: - Product Identifiers
enum IAPProductIds: String, CaseIterable {
    case annualSubscription = "com.syncnos.annual.20"
    case lifetimeLicense = "com.syncnos.lifetime.68"
}

// MARK: - IAP Service (StoreKit 2)
final class IAPService: IAPServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let annualSubscriptionKey = "syncnos.annual.subscription.unlocked"
    private let lifetimeLicenseKey = "syncnos.lifetime.license.unlocked"
    private var updatesTask: Task<Void, Never>?

    static let statusChangedNotification = Notification.Name("IAPServiceStatusChanged")

    var isProUnlocked: Bool {
        // Pro unlocked if either annual subscription or lifetime license is active
        UserDefaults.standard.bool(forKey: annualSubscriptionKey) ||
        UserDefaults.standard.bool(forKey: lifetimeLicenseKey)
    }

    // MARK: - Public API
    func fetchProducts() async throws -> [Product] {
        let ids = IAPProductIds.allCases.map { $0.rawValue }
        let products = try await Product.products(for: ids)
        return products
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    func purchase(product: Product) async throws -> Bool {
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    logger.info("Purchase verified: \(transaction.productID)")
                    await setUnlockedIfNeeded(for: transaction)
                    await transaction.finish()
                    return true
                case .unverified(let transaction, let error):
                    logger.error("Purchase unverified for: \(transaction.productID), error=\(error.localizedDescription)")
                    throw error
                }
            case .userCancelled:
                logger.info("User cancelled purchase")
                return false
            case .pending:
                logger.info("Purchase pending")
                return false
            @unknown default:
                logger.warning("Unknown purchase result")
                return false
            }
        } catch {
            logger.error("Purchase threw error: \(error.localizedDescription)")
            throw error
        }
    }

    func restorePurchases() async -> Bool {
        do {
            try await AppStore.sync()
            logger.info("Requested AppStore.sync()")
            // After sync, refresh entitlements
            let unlocked = await refreshPurchasedStatus()
            return unlocked
        } catch {
            logger.error("Restore failed: \(error.localizedDescription)")
            return false
        }
    }

    func startObservingTransactions() {
        guard updatesTask == nil else { return }
        updatesTask = Task.detached(priority: .background) { [weak self] in
            guard let self else { return }
            for await update in Transaction.updates {
                do {
                    let verification = update
                    switch verification {
                    case .verified(let transaction):
                        await self.setUnlockedIfNeeded(for: transaction)
                        await transaction.finish()
                    case .unverified(_, let error):
                        self.logger.warning("Unverified transaction update: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - Helpers
    @MainActor
    private func setUnlocked(_ productId: String, _ newValue: Bool) {
        let key = keyForProduct(productId)
        let current = UserDefaults.standard.bool(forKey: key)
        guard current != newValue else { return }
        UserDefaults.standard.set(newValue, forKey: key)
        NotificationCenter.default.post(name: Self.statusChangedNotification, object: nil)
        logger.info("Product \(productId) unlocked state changed to: \(newValue)")
    }

    private func keyForProduct(_ productId: String) -> String {
        switch productId {
        case IAPProductIds.annualSubscription.rawValue:
            return annualSubscriptionKey
        case IAPProductIds.lifetimeLicense.rawValue:
            return lifetimeLicenseKey
        default:
            return "syncnos.unknown.product"
        }
    }

    private func setUnlockedIfNeeded(for transaction: Transaction) async {
        // Non-consumable unlock stays as long as not revoked
        let isValid = transaction.revocationDate == nil
        await setUnlocked(transaction.productID, isValid)
    }

    func refreshPurchasedStatus() async -> Bool {
        for productId in IAPProductIds.allCases {
            if let latest = await Transaction.latest(for: productId.rawValue) {
                switch latest {
                case .verified(let transaction):
                    await setUnlocked(transaction.productID, transaction.revocationDate == nil)
                case .unverified(_, let error):
                    logger.warning("Latest transaction unverified for \(productId.rawValue): \(error.localizedDescription)")
                }
            } else {
                await setUnlocked(productId.rawValue, false)
            }
        }
        return isProUnlocked
    }
}
