import Foundation
import StoreKit

// MARK: - Product Identifiers
enum IAPProductIds: String, CaseIterable {
    case pro = "com.chiimagnus.syncnos.pro"
}

// MARK: - IAP Service (StoreKit 2)
final class IAPService: IAPServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let unlockedKey = "syncnos.pro.unlocked"
    private var updatesTask: Task<Void, Never>?

    static let statusChangedNotification = Notification.Name("IAPServiceStatusChanged")

    var isProUnlocked: Bool {
        UserDefaults.standard.bool(forKey: unlockedKey)
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
    private func setUnlocked(_ newValue: Bool) {
        let current = isProUnlocked
        guard current != newValue else { return }
        UserDefaults.standard.set(newValue, forKey: unlockedKey)
        NotificationCenter.default.post(name: Self.statusChangedNotification, object: nil)
        logger.info("Pro unlocked state changed to: \(newValue)")
    }

    private func setUnlockedIfNeeded(for transaction: Transaction) async {
        // Non-consumable unlock stays as long as not revoked
        if transaction.productID == IAPProductIds.pro.rawValue {
            await setUnlocked(transaction.revocationDate == nil)
        }
    }

    func refreshPurchasedStatus() async -> Bool {
        if let latest = await Transaction.latest(for: IAPProductIds.pro.rawValue) {
            switch latest {
            case .verified(let transaction):
                await setUnlocked(transaction.revocationDate == nil)
            case .unverified(_, let error):
                logger.warning("Latest transaction unverified: \(error.localizedDescription)")
            }
        } else {
            await setUnlocked(false)
        }
        return isProUnlocked
    }
}
