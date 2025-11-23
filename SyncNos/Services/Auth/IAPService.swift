import Foundation
import StoreKit
import IOKit

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
    private let firstLaunchDateKey = "syncnos.first.launch.date"
    private let deviceFingerprintKey = "syncnos.device.fingerprint"
    private let lastReminderDateKey = "syncnos.last.reminder.date"
    private let hasShownWelcomeKey = "syncnos.has.shown.welcome"
    private let trialDays = 30
    private var updatesTask: Task<Void, Never>?

    static let statusChangedNotification = Notification.Name("IAPServiceStatusChanged")
    static let showWelcomeNotification = Notification.Name("IAPServiceShowWelcome")
    static let showTrialReminderNotification = Notification.Name("IAPServiceShowTrialReminder")

    var isProUnlocked: Bool {
        // Pro unlocked if either purchased or in trial period
        hasPurchased || isInTrialPeriod
    }

    var hasPurchased: Bool {
        UserDefaults.standard.bool(forKey: annualSubscriptionKey) ||
        UserDefaults.standard.bool(forKey: lifetimeLicenseKey)
    }

    var isInTrialPeriod: Bool {
        guard let firstLaunchDate = getFirstLaunchDate() else {
            // First time launch, record it and return true
            recordFirstLaunch()
            return true
        }
        let daysSinceLaunch = Calendar.current.dateComponents([.day], from: firstLaunchDate, to: Date()).day ?? 0
        return daysSinceLaunch < trialDays
    }

    var trialDaysRemaining: Int {
        guard let firstLaunchDate = getFirstLaunchDate() else { return trialDays }
        let daysSinceLaunch = Calendar.current.dateComponents([.day], from: firstLaunchDate, to: Date()).day ?? 0
        return max(0, trialDays - daysSinceLaunch)
    }

    var hasShownWelcome: Bool {
        UserDefaults.standard.bool(forKey: hasShownWelcomeKey)
    }

    func markWelcomeShown() {
        UserDefaults.standard.set(true, forKey: hasShownWelcomeKey)
    }

    func shouldShowTrialReminder() -> Bool {
        // Don't show if already purchased
        guard !hasPurchased else { return false }
        
        // Don't show if trial not started or expired
        guard isInTrialPeriod else { return false }
        
        let remaining = trialDaysRemaining
        
        // Show reminder at 7, 3, 1 days remaining
        guard remaining == 7 || remaining == 3 || remaining == 1 else { return false }
        
        // Check if we already showed reminder today
        if let lastReminder = UserDefaults.standard.object(forKey: lastReminderDateKey) as? Date {
            let calendar = Calendar.current
            if calendar.isDateInToday(lastReminder) {
                return false
            }
        }
        
        return true
    }

    func markReminderShown() {
        UserDefaults.standard.set(Date(), forKey: lastReminderDateKey)
    }

    private func getFirstLaunchDate() -> Date? {
        // Try UserDefaults first
        if let date = UserDefaults.standard.object(forKey: firstLaunchDateKey) as? Date {
            return date
        }
        
        // Try Keychain as backup (more persistent)
        if let keychainDate = KeychainHelper.shared.getFirstLaunchDate() {
            // Sync back to UserDefaults
            UserDefaults.standard.set(keychainDate, forKey: firstLaunchDateKey)
            return keychainDate
        }
        
        return nil
    }

    private func recordFirstLaunch() {
        guard getFirstLaunchDate() == nil else { return }
        
        let now = Date()
        
        // Save to both UserDefaults and Keychain
        UserDefaults.standard.set(now, forKey: firstLaunchDateKey)
        KeychainHelper.shared.saveFirstLaunchDate(now)
        
        // Generate and save device fingerprint
        let fingerprint = generateDeviceFingerprint()
        UserDefaults.standard.set(fingerprint, forKey: deviceFingerprintKey)
        KeychainHelper.shared.saveDeviceFingerprint(fingerprint)
        
        logger.info("First launch recorded, 30-day trial started")
        logger.info("Device fingerprint: \(fingerprint)")
    }

    private func generateDeviceFingerprint() -> String {
        // Use hardware UUID as device fingerprint (survives app reinstall)
        var uuid = ""
        
        // Get hardware UUID from IOKit
        let platformExpert = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        if platformExpert != 0 {
            if let serialNumber = IORegistryEntryCreateCFProperty(platformExpert, kIOPlatformUUIDKey as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String {
                uuid = serialNumber
            }
            IOObjectRelease(platformExpert)
        }
        
        // Fallback to a combination of system info
        if uuid.isEmpty {
            let host = Host.current()
            uuid = "\(host.localizedName ?? "unknown")-\(ProcessInfo.processInfo.hostName)"
        }
        
        return uuid
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


// MARK: - Debug Functions (Development Only)
extension IAPService {
    
    func resetAllPurchaseData() throws {
        // 1. Check environment
        guard DIContainer.shared.environmentDetector.isDevEnvironment() else {
            logger.error("Reset attempted in production environment - blocked")
            throw IAPError.productionEnvironmentResetNotAllowed
        }
        
        // 2. Record state before reset
        let beforeState = getDebugInfo()
        logger.info("Starting IAP reset. Before state: hasPurchasedAnnual=\(beforeState.hasPurchasedAnnual), hasPurchasedLifetime=\(beforeState.hasPurchasedLifetime), isInTrialPeriod=\(beforeState.isInTrialPeriod), trialDaysRemaining=\(beforeState.trialDaysRemaining)")
        
        // 3. Clear UserDefaults
        logger.info("Clearing UserDefaults IAP keys...")
        UserDefaults.standard.removeObject(forKey: annualSubscriptionKey)
        UserDefaults.standard.removeObject(forKey: lifetimeLicenseKey)
        UserDefaults.standard.removeObject(forKey: firstLaunchDateKey)
        UserDefaults.standard.removeObject(forKey: deviceFingerprintKey)
        UserDefaults.standard.removeObject(forKey: lastReminderDateKey)
        UserDefaults.standard.removeObject(forKey: hasShownWelcomeKey)
        logger.info("UserDefaults cleared")
        
        // 4. Clear Keychain
        logger.info("Clearing Keychain IAP data...")
        KeychainHelper.shared.deleteFirstLaunchDate()
        KeychainHelper.shared.deleteDeviceFingerprint()
        logger.info("Keychain cleared")
        
        // 5. Notify status change
        Task { @MainActor in
            NotificationCenter.default.post(
                name: Self.statusChangedNotification,
                object: nil
            )
        }
        logger.info("Status change notification sent")
        
        // 6. Record state after reset
        let afterState = getDebugInfo()
        logger.info("IAP reset complete. After state: hasPurchasedAnnual=\(afterState.hasPurchasedAnnual), hasPurchasedLifetime=\(afterState.hasPurchasedLifetime), isInTrialPeriod=\(afterState.isInTrialPeriod), trialDaysRemaining=\(afterState.trialDaysRemaining)")
    }
    
    func getDebugInfo() -> IAPDebugInfo {
        return IAPDebugInfo(
            hasPurchasedAnnual: UserDefaults.standard.bool(forKey: annualSubscriptionKey),
            hasPurchasedLifetime: UserDefaults.standard.bool(forKey: lifetimeLicenseKey),
            isInTrialPeriod: isInTrialPeriod,
            trialDaysRemaining: trialDaysRemaining,
            firstLaunchDate: getFirstLaunchDate(),
            deviceFingerprint: UserDefaults.standard.string(forKey: deviceFingerprintKey),
            lastReminderDate: UserDefaults.standard.object(forKey: lastReminderDateKey) as? Date,
            hasShownWelcome: UserDefaults.standard.bool(forKey: hasShownWelcomeKey),
            environmentType: DIContainer.shared.environmentDetector.environmentType(),
            userDefaultsKeys: getAllIAPUserDefaultsKeys(),
            keychainData: getAllIAPKeychainData()
        )
    }
    
    func simulatePurchaseState(_ state: SimulatedPurchaseState) throws {
        // 1. Check environment
        guard DIContainer.shared.environmentDetector.isDevEnvironment() else {
            logger.error("Simulation attempted in production environment - blocked")
            throw IAPError.productionEnvironmentSimulationNotAllowed
        }
        
        logger.info("Simulating purchase state: \(state)")
        
        // 2. Apply simulation
        switch state {
        case .purchasedAnnual:
            UserDefaults.standard.set(true, forKey: annualSubscriptionKey)
            logger.info("Simulated: Annual subscription purchased")
            
        case .purchasedLifetime:
            UserDefaults.standard.set(true, forKey: lifetimeLicenseKey)
            logger.info("Simulated: Lifetime license purchased")
            
        case .trialDay(let day):
            let targetDate = Calendar.current.date(byAdding: .day, value: -day, to: Date())!
            UserDefaults.standard.set(targetDate, forKey: firstLaunchDateKey)
            KeychainHelper.shared.saveFirstLaunchDate(targetDate)
            logger.info("Simulated: Trial day \(day) (first launch: \(targetDate))")
            
        case .trialExpired:
            let expiredDate = Calendar.current.date(byAdding: .day, value: -31, to: Date())!
            UserDefaults.standard.set(expiredDate, forKey: firstLaunchDateKey)
            KeychainHelper.shared.saveFirstLaunchDate(expiredDate)
            logger.info("Simulated: Trial expired (first launch: \(expiredDate))")
            
        case .reset:
            try resetAllPurchaseData()
            return // resetAllPurchaseData already sends notification
        }
        
        // 3. Notify status change
        Task { @MainActor in
            NotificationCenter.default.post(
                name: Self.statusChangedNotification,
                object: nil
            )
        }
        
        logger.info("Simulation complete. New state: \(getDebugInfo())")
    }
    
    // MARK: - Private Helpers
    
    private func getAllIAPUserDefaultsKeys() -> [String: String] {
        var result: [String: String] = [:]
        
        let keys = [
            annualSubscriptionKey,
            lifetimeLicenseKey,
            firstLaunchDateKey,
            deviceFingerprintKey,
            lastReminderDateKey,
            hasShownWelcomeKey
        ]
        
        for key in keys {
            if let value = UserDefaults.standard.object(forKey: key) {
                result[key] = String(describing: value)
            }
        }
        
        return result
    }
    
    private func getAllIAPKeychainData() -> [String: String] {
        var result: [String: String] = [:]
        
        if let firstLaunch = KeychainHelper.shared.getFirstLaunchDate() {
            result["firstLaunchDate"] = ISO8601DateFormatter().string(from: firstLaunch)
        }
        
        if let fingerprint = KeychainHelper.shared.getDeviceFingerprint() {
            result["deviceFingerprint"] = fingerprint
        }
        
        return result
    }
}
