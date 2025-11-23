import Foundation

// MARK: - Purchase Type
enum PurchaseType {
    case none
    case annual
    case lifetime
    
    var displayName: String {
        switch self {
        case .none: return "None"
        case .annual: return "Annual Subscription"
        case .lifetime: return "Lifetime License"
        }
    }
}

// MARK: - IAP Debug Info
struct IAPDebugInfo: Codable {
    let hasPurchasedAnnual: Bool
    let hasPurchasedLifetime: Bool
    let isInTrialPeriod: Bool
    let trialDaysRemaining: Int
    let firstLaunchDate: Date?
}

// MARK: - Simulated Purchase State
enum SimulatedPurchaseState {
    case purchasedAnnual
    case purchasedLifetime
    case trialDay(Int)        // 试用期第 N 天
    case trialExpired
    case reset                // 完全重置
}

// MARK: - IAP Error
enum IAPError: LocalizedError {
    case resetFailed(String)
    case simulationFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .resetFailed(let reason):
            return String(format: NSLocalizedString("Reset failed: %@", comment: ""), reason)
        case .simulationFailed(let reason):
            return String(format: NSLocalizedString("Simulation failed: %@", comment: ""), reason)
        }
    }
}
