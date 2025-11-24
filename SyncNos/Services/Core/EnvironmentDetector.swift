import Foundation

// MARK: - Environment Type
enum EnvironmentType: String, Codable {
    case development
    case production
    
    var description: String {
        switch self {
        case .development: return "Development"
        case .production: return "Production"
        }
    }
}

// MARK: - Environment Detector Protocol
protocol EnvironmentDetectorProtocol {
    func isDevEnvironment() -> Bool
    func environmentType() -> EnvironmentType
}

// MARK: - Environment Detector
final class EnvironmentDetector: EnvironmentDetectorProtocol {
    
    func isDevEnvironment() -> Bool {
        return environmentType() == .development
    }
    
    func environmentType() -> EnvironmentType {
        // 1. Check if running from Xcode (DEBUG flag)
        #if DEBUG
        return .development
        #else
        
        // 2. Check for StoreKit Configuration File usage
        if isUsingStoreKitConfigFile() {
            return .development
        }
        
        // 3. Check App Store receipt location
        if isAppStoreReceipt() {
            return .production
        }
        
        // Default to development for safety (better to show debug features than hide them)
        return .development
        #endif
    }
    
    // MARK: - Private Helpers
    
    /// Check if using StoreKit Configuration File
    /// StoreKit Configuration File is only available in development/testing
    private func isUsingStoreKitConfigFile() -> Bool {
        // Check if StoreKit Testing is enabled via environment variable
        if let storeKitTest = ProcessInfo.processInfo.environment["STOREKIT_TEST"] {
            return storeKitTest == "1" || storeKitTest.lowercased() == "true"
        }
        
        // Check for sandbox receipt (StoreKit Configuration File uses sandbox)
        if let receiptURL = Bundle.main.appStoreReceiptURL {
            return receiptURL.lastPathComponent == "sandboxReceipt"
        }
        
        return false
    }
    
    /// Check if this is a production App Store receipt
    private func isAppStoreReceipt() -> Bool {
        guard let receiptURL = Bundle.main.appStoreReceiptURL else {
            return false
        }
        
        // Production receipts are named "receipt" (not "sandboxReceipt")
        let isProductionReceipt = receiptURL.lastPathComponent == "receipt"
        
        // Also check if receipt file actually exists
        let receiptExists = FileManager.default.fileExists(atPath: receiptURL.path)
        
        return isProductionReceipt && receiptExists
    }
}
