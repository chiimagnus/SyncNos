import Foundation
import Combine

@MainActor
final class IAPDebugViewModel: ObservableObject {
    @Published var debugInfo: IAPDebugInfo?
    
    private let iapService: IAPServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var cancellables = Set<AnyCancellable>()
    
    init(iapService: IAPServiceProtocol = DIContainer.shared.iapService) {
        self.iapService = iapService
        
        // Subscribe to IAP status changes
        NotificationCenter.default
            .publisher(for: IAPService.statusChangedNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshDebugInfo()
            }
            .store(in: &cancellables)
    }
    
    func onAppear() {
        refreshDebugInfo()
    }
    
    func refreshDebugInfo() {
        debugInfo = iapService.getDebugInfo()
    }
    
    func requestReset() {
        do {
            try iapService.resetAllPurchaseData()
            logger.debug("IAP data reset successfully")
            refreshDebugInfo()
        } catch {
            logger.error("Reset failed: \(error.localizedDescription)")
        }
    }
    
    func simulateState(_ state: SimulatedPurchaseState) {
        do {
            try iapService.simulatePurchaseState(state)
            logger.debug("IAP state simulated successfully")
            refreshDebugInfo()
        } catch {
            logger.error("Simulation failed: \(error.localizedDescription)")
        }
    }
}
