import Foundation
import StoreKit
import IOKit

// MARK: - Product Identifiers
/// IAP 产品 ID 定义
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
        guard getFirstLaunchDate() == nil else {
            logger.debug("⏭️ 首次启动已记录，跳过重复记录")
            return
        }
        
        let now = Date()
        
        // 双重存储策略：
        // 1. UserDefaults：快速访问，用于日常判断
        // 2. Keychain：更持久，防止 UserDefaults 被清除
        logger.debug("📝 记录首次启动...")
        
        UserDefaults.standard.set(now, forKey: firstLaunchDateKey)
        logger.debug("  💾 已保存到 UserDefaults: \(firstLaunchDateKey)")
        
        KeychainHelper.shared.saveFirstLaunchDate(now)
        logger.debug("  🔐 已保存到 Keychain (更持久)")
        
        // 生成并保存设备指纹，用于防止试用期滥用
        let fingerprint = generateDeviceFingerprint()
        UserDefaults.standard.set(fingerprint, forKey: deviceFingerprintKey)
        KeychainHelper.shared.saveDeviceFingerprint(fingerprint)
        logger.debug("  🔑 设备指纹已生成并保存: \(fingerprint)")
        
        logger.info("✅ 首次启动已记录 - 30天试用期已开始")
        logger.info("📅 试用期开始时间: \(now)")
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
            logger.debug("🔄 开始恢复购买流程...")
            logger.debug("📱 当前 Apple ID 的购买记录将从 Apple 服务器同步")
            
            // 1. 从 Apple 服务器同步最新的购买记录
            // 这是跨设备恢复的关键步骤：
            // - 同一 Apple ID 换电脑：✅ 可恢复（AppStore.sync() 会从服务器拉取购买记录）
            // - 不同 Apple ID：❌ 无法恢复（购买绑定到原 Apple ID）
            logger.debug("🌐 正在从 Apple 服务器 fetch 购买记录...")
            try await AppStore.sync()
            logger.info("✅ AppStore.sync() 完成 - 已从 Apple 服务器同步购买记录到本地 StoreKit 缓存")

            // 2. 查询每个产品的最新交易记录，更新本地缓存
            logger.debug("🔍 查询本地缓存的购买状态...")
            let unlocked = await refreshPurchasedStatus()
            
            if unlocked {
                logger.info("✅ 恢复成功 - 检测到有效的购买记录")
            } else {
                logger.info("ℹ️ 恢复完成 - 未找到有效的购买记录")
            }
            
            return unlocked
        } catch {
            logger.error("❌ 恢复购买失败: \(error.localizedDescription)")
            logger.error("💡 提示：确保使用与购买时相同的 Apple ID")
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
        
        // 只有状态改变时才更新
        guard current != newValue else {
            logger.debug("  ℹ️ 产品 \(productId) 状态未变化，跳过更新")
            return
        }
        
        // 更新 UserDefaults 本地缓存
        UserDefaults.standard.set(newValue, forKey: key)
        logger.debug("  💾 已更新 UserDefaults: \(key) = \(newValue)")
        
        // 发送通知，触发 UI 更新
        NotificationCenter.default.post(name: Self.statusChangedNotification, object: nil)
        logger.info("🔔 产品 \(productId) 解锁状态已变更: \(newValue)")
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
        logger.debug("🔄 刷新购买状态 - 从本地 StoreKit 缓存查询最新交易记录")
        logger.debug("   (注：数据来自 AppStore.sync() 同步的本地缓存，非实时 fetch Apple 服务器)")
        
        for productId in IAPProductIds.allCases {
            logger.debug("  📦 检查产品: \(productId.rawValue)")
            
            // 从本地 StoreKit 缓存获取最新交易
            // Transaction.latest() 返回该产品的最新有效交易（从本地缓存读取）
            if let latest = await Transaction.latest(for: productId.rawValue) {
                switch latest {
                case .verified(let transaction):
                    // 验证通过，检查是否被撤销
                    let isValid = transaction.revocationDate == nil
                    logger.debug("    ✅ 交易验证通过 - 产品ID: \(transaction.productID), 有效: \(isValid)")
                    logger.debug("    📅 购买日期: \(transaction.purchaseDate)")
                    if let expirationDate = transaction.expirationDate {
                        logger.debug("    ⏰ 到期日期: \(expirationDate)")
                    }
                    
                    // 更新本地 UserDefaults 缓存
                    await setUnlocked(transaction.productID, isValid)
                    
                case .unverified(_, let error):
                    logger.warning("    ⚠️ 交易验证失败 - 产品: \(productId.rawValue), 错误: \(error.localizedDescription)")
                }
            } else {
                logger.debug("    ℹ️ 未找到该产品的交易记录")
                await setUnlocked(productId.rawValue, false)
            }
        }
        
        logger.debug("✅ 购买状态刷新完成 - isProUnlocked: \(isProUnlocked)")
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
