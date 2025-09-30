import Foundation
import StoreKit

@MainActor
final class IAPViewModel: ObservableObject {
    @Published var products: [Product] = []
    @Published var isProUnlocked: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let iapService: IAPServiceProtocol
    private let productIds: [String]

    init(iapService: IAPServiceProtocol = DIContainer.shared.iapService,
         productIds: [String] = ["com.chiimagnus.syncnos.pro"]) {
        self.iapService = iapService
        self.productIds = productIds
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await iapService.fetchProducts(ids: productIds)
            self.products = loaded
            self.isProUnlocked = try await checkProUnlocked()
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    func buy(_ product: Product) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let ok = try await iapService.purchase(product)
            if ok {
                self.isProUnlocked = try await checkProUnlocked()
            }
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    func restore() async {
        isLoading = true
        defer { isLoading = false }
        await iapService.restore()
        self.isProUnlocked = (try? await checkProUnlocked()) ?? self.isProUnlocked
    }

    private func checkProUnlocked() async throws -> Bool {
        guard let proId = productIds.first else { return false }
        return await iapService.isPurchased(productId: proId)
    }
}


