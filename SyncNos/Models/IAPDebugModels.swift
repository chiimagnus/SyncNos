import Foundation

// MARK: - IAP Debug Info
struct IAPDebugInfo: Codable {
    let hasPurchasedAnnual: Bool
    let hasPurchasedLifetime: Bool
    let isInTrialPeriod: Bool
    let trialDaysRemaining: Int
    let firstLaunchDate: Date?
    let deviceFingerprint: String?
    let lastReminderDate: Date?
    let hasShownWelcome: Bool
    let environmentType: EnvironmentType
    let userDefaultsKeys: [String: String]
    let keychainData: [String: String]
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
    case productionEnvironmentResetNotAllowed
    case productionEnvironmentSimulationNotAllowed
    case resetFailed(String)
    case simulationFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .productionEnvironmentResetNotAllowed:
            return NSLocalizedString("Reset is not allowed in production environment", comment: "")
        case .productionEnvironmentSimulationNotAllowed:
            return NSLocalizedString("Simulation is not allowed in production environment", comment: "")
        case .resetFailed(let reason):
            return String(format: NSLocalizedString("Reset failed: %@", comment: ""), reason)
        case .simulationFailed(let reason):
            return String(format: NSLocalizedString("Simulation failed: %@", comment: ""), reason)
        }
    }
}
