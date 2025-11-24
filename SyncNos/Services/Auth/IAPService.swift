import Foundation
import StoreKit
import IOKit

// MARK: - Product Identifiers
/// - annualSubscription: 年度订阅 ($18/年)
/// - lifetimeLicense: 终身买断 ($68 一次性)
enum IAPProductIds: String, CaseIterable {
    case annualSubscription = "com.syncnos.annual.18"
    case lifetimeLicense = "com.syncnos.lifetime.68"
}

// MARK: - IAP Service (StoreKit 2)
/// IAP 服务管理类，处理应用内购买、试用期和购买恢复
/// 
/// 数据存储策略：
/// 1. 购买状态 (UserDefaults)：快速本地缓存，用于 UI 判断
/// 2. 购买状态 (Apple 服务器)：真实来源，通过 Restore Purchases 同步
/// 3. 试用期数据 (UserDefaults + Keychain)：双重存储，Keychain 更持久
/// 4. 设备指纹 (UserDefaults + Keychain)：防止试用期滥用
///
/// 跨设备恢复：
/// - 同一 Apple ID 换电脑：✅ 可恢复（通过 Restore Purchases 从 Apple 服务器同步）
/// - 不同 Apple ID：❌ 无法恢复（购买绑定到原 Apple ID）
/// - 本地缓存：❌ 无法跨设备（仅存储在本机）
final class IAPService: IAPServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    
    // MARK: - UserDefaults Keys (本地缓存)
    /// 年度订阅购买状态缓存 (UserDefaults)
    private let annualSubscriptionKey = "syncnos.annual.subscription.unlocked"
    /// 终身买断购买状态缓存 (UserDefaults)
    private let lifetimeLicenseKey = "syncnos.lifetime.license.unlocked"
    /// 首次启动日期 (UserDefaults + Keychain 双重存储)
    private let firstLaunchDateKey = "syncnos.first.launch.date"
    /// 设备指纹 (UserDefaults + Keychain 双重存储)
    private let deviceFingerprintKey = "syncnos.device.fingerprint"
    /// 最后一次试用期提醒日期
    private let lastReminderDateKey = "syncnos.last.reminder.date"
    /// 是否已显示欢迎页面
    private let hasShownWelcomeKey = "syncnos.has.shown.welcome"
    
    // MARK: - Transaction ID 存储（用于判断是否重复购买）
    /// 年度订阅的最后一次 Transaction ID
    private let annualSubscriptionTransactionIdKey = "syncnos.annual.subscription.transaction.id"
    /// 终身买断的最后一次 Transaction ID
    private let lifetimeLicenseTransactionIdKey = "syncnos.lifetime.license.transaction.id"
    
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
    
    var hasPurchasedAnnual: Bool {
        UserDefaults.standard.bool(forKey: annualSubscriptionKey)
    }
    
    var hasPurchasedLifetime: Bool {
        UserDefaults.standard.bool(forKey: lifetimeLicenseKey)
    }
    
    var purchaseType: PurchaseType {
        if hasPurchasedLifetime {
            return .lifetime
        } else if hasPurchasedAnnual {
            return .annual
        } else {
            return .none
        }
    }
    
    /// 是否曾经购买过年订阅（包括已过期的）
    var hasEverPurchasedAnnual: Bool {
        // 检查是否有年订阅的 Transaction ID 记录
        return UserDefaults.standard.string(forKey: annualSubscriptionTransactionIdKey) != nil
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
        
        UserDefaults.standard.set(now, forKey: firstLaunchDateKey)
        KeychainHelper.shared.saveFirstLaunchDate(now)
        
        let fingerprint = generateDeviceFingerprint()
        UserDefaults.standard.set(fingerprint, forKey: deviceFingerprintKey)
        KeychainHelper.shared.saveDeviceFingerprint(fingerprint)
        
        logger.info("Trial period started")
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
                    await setUnlockedIfNeeded(for: transaction)
                    await transaction.finish()
                    return true
                    
                case .unverified(_, let error):
                    logger.error("Transaction verification failed: \(error.localizedDescription)")
                    throw error
                }
            case .userCancelled:
                return false
            case .pending:
                return false
            @unknown default:
                return false
            }
        } catch {
            logger.error("Purchase failed: \(error.localizedDescription)")
            throw error
        }
    }

    func restorePurchases() async -> Bool {
        do {
            try await AppStore.sync()
            let unlocked = await refreshPurchasedStatus()
            return unlocked
        } catch {
            logger.error("Restore purchases failed: \(error.localizedDescription)")
            return false
        }
    }

    func startObservingTransactions() {
        guard updatesTask == nil else { return }
        
        // 1. 监听新交易（购买、续费、退款等）
        updatesTask = Task.detached(priority: .background) { [weak self] in
            guard let self else { return }
            for await update in Transaction.updates {
                switch update {
                case .verified(let transaction):
                    await self.setUnlockedIfNeeded(for: transaction)
                    await transaction.finish()
                    // 交易更新后，立即刷新所有产品的状态（检查过期）
                    _ = await self.refreshPurchasedStatus()
                case .unverified(_, let error):
                    self.logger.error("Transaction verification failed: \(error.localizedDescription)")
                }
            }
        }
        
        // 2. 定期检查订阅过期状态（每小时检查一次）
        Task.detached(priority: .background) { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3600 * 1_000_000_000)
                
                let wasUnlocked = self.isProUnlocked
                _ = await self.refreshPurchasedStatus()
                let isUnlocked = self.isProUnlocked
                
                // 如果状态从解锁变为锁定，说明订阅过期了
                if wasUnlocked && !isUnlocked {
                    await MainActor.run {
                        NotificationCenter.default.post(
                            name: Self.statusChangedNotification,
                            object: nil
                        )
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
        // 1. 检查是否被撤销
        let isRevoked = transaction.revocationDate != nil
        
        // 2. 检查订阅是否过期（仅适用于订阅类产品）
        var isExpired = false
        if let expirationDate = transaction.expirationDate {
            isExpired = expirationDate < Date()
        }
        
        // 3. 综合判断：未被撤销 且 未过期
        let isValid = !isRevoked && !isExpired
        
        // 保存 Transaction ID（用于判断重复购买）
        let currentTransactionId = String(transaction.id)
        if getPreviousTransactionId(for: transaction.productID) == nil {
            savePreviousTransactionId(currentTransactionId, for: transaction.productID)
        }

        await setUnlocked(transaction.productID, isValid)
    }
    
    // MARK: - Transaction ID 管理
    
    private func getPreviousTransactionId(for productId: String) -> String? {
        let key = transactionIdKey(for: productId)
        return UserDefaults.standard.string(forKey: key)
    }
    
    private func savePreviousTransactionId(_ transactionId: String, for productId: String) {
        let key = transactionIdKey(for: productId)
        UserDefaults.standard.set(transactionId, forKey: key)
    }
    
    private func transactionIdKey(for productId: String) -> String {
        switch productId {
        case IAPProductIds.annualSubscription.rawValue:
            return annualSubscriptionTransactionIdKey
        case IAPProductIds.lifetimeLicense.rawValue:
            return lifetimeLicenseTransactionIdKey
        default:
            return "syncnos.unknown.transaction.id"
        }
    }

    func refreshPurchasedStatus() async -> Bool {
        for productId in IAPProductIds.allCases {
            if let latest = await Transaction.latest(for: productId.rawValue) {
                switch latest {
                case .verified(let transaction):
                    // 1. 检查是否被撤销
                    let isRevoked = transaction.revocationDate != nil
                    
                    // 2. 检查订阅是否过期（仅适用于订阅类产品）
                    var isExpired = false
                    if let expirationDate = transaction.expirationDate {
                        isExpired = expirationDate < Date()
                    }
                    
                    // 3. 综合判断：未被撤销 且 未过期
                    let isValid = !isRevoked && !isExpired
                    
                    // 保存 Transaction ID（用于 hasEverPurchasedAnnual 判断）
                    let currentTransactionId = String(transaction.id)
                    if getPreviousTransactionId(for: transaction.productID) == nil {
                        savePreviousTransactionId(currentTransactionId, for: transaction.productID)
                    }
                    
                    await setUnlocked(transaction.productID, isValid)
                    
                case .unverified(_, let error):
                    logger.error("Transaction verification failed: \(error.localizedDescription)")
                    await setUnlocked(productId.rawValue, false)
                }
            } else {
                await setUnlocked(productId.rawValue, false)
            }
        }
        
        return isProUnlocked
    }
    
    // MARK: - Purchase Details
    
    /// 获取年度订阅的到期时间（如果有）
    func getAnnualSubscriptionExpirationDate() async -> Date? {
        guard let latest = await Transaction.latest(for: IAPProductIds.annualSubscription.rawValue) else {
            return nil
        }
        
        switch latest {
        case .verified(let transaction):
            return transaction.expirationDate
        case .unverified:
            return nil
        }
    }
    
    /// 获取购买日期
    func getPurchaseDate() async -> Date? {
        // 优先返回终身购买日期，其次是年度订阅
        if hasPurchasedLifetime {
            if let latest = await Transaction.latest(for: IAPProductIds.lifetimeLicense.rawValue) {
                switch latest {
                case .verified(let transaction):
                    return transaction.purchaseDate
                case .unverified:
                    return nil
                }
            }
        }
        
        if hasPurchasedAnnual {
            if let latest = await Transaction.latest(for: IAPProductIds.annualSubscription.rawValue) {
                switch latest {
                case .verified(let transaction):
                    return transaction.purchaseDate
                case .unverified:
                    return nil
                }
            }
        }
        
        return nil
    }
}


// MARK: - Debug Functions (Development Only)
extension IAPService {
    
    func resetAllPurchaseData() throws {
        let beforeState = getDebugInfo()
        logger.debug("Starting IAP reset. Before state: hasPurchasedAnnual=\(beforeState.hasPurchasedAnnual), hasPurchasedLifetime=\(beforeState.hasPurchasedLifetime), isInTrialPeriod=\(beforeState.isInTrialPeriod), trialDaysRemaining=\(beforeState.trialDaysRemaining)")
        
        logger.debug("Clearing UserDefaults IAP keys...")
        UserDefaults.standard.removeObject(forKey: annualSubscriptionKey)
        UserDefaults.standard.removeObject(forKey: lifetimeLicenseKey)
        UserDefaults.standard.removeObject(forKey: firstLaunchDateKey)
        UserDefaults.standard.removeObject(forKey: deviceFingerprintKey)
        UserDefaults.standard.removeObject(forKey: lastReminderDateKey)
        UserDefaults.standard.removeObject(forKey: hasShownWelcomeKey)
        // 清除 Transaction ID（用于 hasEverPurchasedAnnual 判断）
        UserDefaults.standard.removeObject(forKey: annualSubscriptionTransactionIdKey)
        UserDefaults.standard.removeObject(forKey: lifetimeLicenseTransactionIdKey)
        logger.debug("UserDefaults cleared")
        
        logger.debug("Clearing Keychain IAP data...")
        KeychainHelper.shared.deleteFirstLaunchDate()
        KeychainHelper.shared.deleteDeviceFingerprint()
        logger.debug("Keychain cleared")
        
        Task { @MainActor in
            NotificationCenter.default.post(
                name: Self.statusChangedNotification,
                object: nil
            )
        }
        logger.debug("Status change notification sent")
        
        let afterState = getDebugInfo()
        logger.debug("IAP reset complete. After state: hasPurchasedAnnual=\(afterState.hasPurchasedAnnual), hasPurchasedLifetime=\(afterState.hasPurchasedLifetime), isInTrialPeriod=\(afterState.isInTrialPeriod), trialDaysRemaining=\(afterState.trialDaysRemaining)")
    }
    
    func getDebugInfo() -> IAPDebugInfo {
        return IAPDebugInfo(
            hasPurchasedAnnual: UserDefaults.standard.bool(forKey: annualSubscriptionKey),
            hasPurchasedLifetime: UserDefaults.standard.bool(forKey: lifetimeLicenseKey),
            isInTrialPeriod: isInTrialPeriod,
            trialDaysRemaining: trialDaysRemaining,
            firstLaunchDate: getFirstLaunchDate()
        )
    }
    
    func simulatePurchaseState(_ state: SimulatedPurchaseState) throws {
        logger.debug("Simulating purchase state: \(state)")
        
        switch state {
        case .purchasedAnnual:
            UserDefaults.standard.set(true, forKey: annualSubscriptionKey)
            logger.debug("Simulated: Annual subscription purchased")
            
        case .purchasedLifetime:
            UserDefaults.standard.set(true, forKey: lifetimeLicenseKey)
            logger.debug("Simulated: Lifetime license purchased")
            
        case .trialDay(let day):
            let targetDate = Calendar.current.date(byAdding: .day, value: -day, to: Date())!
            UserDefaults.standard.set(targetDate, forKey: firstLaunchDateKey)
            KeychainHelper.shared.saveFirstLaunchDate(targetDate)
            logger.debug("Simulated: Trial day \(day) (first launch: \(targetDate))")
            
        case .trialExpired:
            let expiredDate = Calendar.current.date(byAdding: .day, value: -31, to: Date())!
            UserDefaults.standard.set(expiredDate, forKey: firstLaunchDateKey)
            KeychainHelper.shared.saveFirstLaunchDate(expiredDate)
            logger.debug("Simulated: Trial expired (first launch: \(expiredDate))")
            
        case .reset:
            try resetAllPurchaseData()
            return // resetAllPurchaseData already sends notification
        }
        
        Task { @MainActor in
            NotificationCenter.default.post(
                name: Self.statusChangedNotification,
                object: nil
            )
        }
        
        logger.debug("Simulation complete. New state: \(getDebugInfo())")
    }
}
