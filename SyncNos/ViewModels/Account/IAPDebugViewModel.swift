import Foundation
import Combine

@MainActor
final class IAPDebugViewModel: ObservableObject {
    @Published var debugInfo: IAPDebugInfo?
    @Published var isDevEnvironment: Bool = false
    @Published var showResetConfirmation: Bool = false
    @Published var showAlert: Bool = false
    @Published var alertMessage: String?
    
    private let iapService: IAPServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var cancellables = Set<AnyCancellable>()
    
    init(iapService: IAPServiceProtocol = DIContainer.shared.iapService) {
        self.iapService = iapService
        self.isDevEnvironment = DIContainer.shared.environmentDetector.isDevEnvironment()
        
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
        showResetConfirmation = true
    }
    
    func confirmReset() {
        do {
            try iapService.resetAllPurchaseData()
            alertMessage = NSLocalizedString("Reset successful. All IAP data has been cleared.", comment: "")
            showAlert = true
            refreshDebugInfo()
        } catch {
            alertMessage = String(format: NSLocalizedString("Reset failed: %@", comment: ""), error.localizedDescription)
            showAlert = true
            logger.error("Reset failed: \(error.localizedDescription)")
        }
    }
    
    func simulateState(_ state: SimulatedPurchaseState) {
        do {
            try iapService.simulatePurchaseState(state)
            alertMessage = NSLocalizedString("State simulated successfully.", comment: "")
            showAlert = true
            refreshDebugInfo()
        } catch {
            alertMessage = String(format: NSLocalizedString("Simulation failed: %@", comment: ""), error.localizedDescription)
            showAlert = true
            logger.error("Simulation failed: \(error.localizedDescription)")
        }
    }
}
