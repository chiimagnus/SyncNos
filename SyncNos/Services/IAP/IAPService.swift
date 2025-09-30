import Foundation
import StoreKit

final class IAPService: IAPServiceProtocol {
    private var updatesTask: Task<Void, Never>?
    private let logger: LoggerServiceProtocol

    init(logger: LoggerServiceProtocol) {
        self.logger = logger
    }

    func start() {
        // Listen for ongoing transaction updates
        updatesTask = Task { [weak self] in
            await self?.listenForTransactions()
        }
    }

    func stop() {
        updatesTask?.cancel()
        updatesTask = nil
    }

    func fetchProducts(ids: [String]) async throws -> [Product] {
        return try await Product.products(for: ids)
    }

    func purchase(_ product: Product) async throws -> Bool {
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            switch verification {
            case .verified(let transaction):
                logger.info("Purchase verified: \(transaction.productID)")
                await transaction.finish()
                return true
            case .unverified:
                logger.warning("Purchase unverified for product: \(product.id)")
                return false
            }
        case .userCancelled:
            logger.info("Purchase cancelled by user: \(product.id)")
            return false
        case .pending:
            logger.info("Purchase pending: \(product.id)")
            return false
        @unknown default:
            logger.warning("Purchase returned unknown result for product: \(product.id)")
            return false
        }
    }

    func restore() async {
        do {
            try await AppStore.sync()
            logger.info("Triggered AppStore.sync()")
        } catch {
            logger.error("Failed to sync App Store: \(error.localizedDescription)")
        }
    }

    func isPurchased(productId: String) async -> Bool {
        do {
            for await result in Transaction.currentEntitlements {
                switch result {
                case .verified(let transaction):
                    if transaction.productID == productId { return true }
                case .unverified:
                    continue
                }
            }
        }
        return false
    }

    private func listenForTransactions() async {
        do {
            for await result in Transaction.updates {
                switch result {
                case .verified(let transaction):
                    logger.info("Transaction update verified: \(transaction.productID)")
                    await transaction.finish()
                case .unverified(let transaction, let error):
                    logger.warning("Unverified transaction: \(transaction.productID), error: \(String(describing: error))")
                }
            }
        }
    }
}


