import Foundation
import ServiceManagement
import AppKit

/// 使用 SMAppService 管理 Helper Login Item（破坏式重构后实现 1b 策略）
final class BackgroundActivityService: BackgroundActivityServiceProtocol {
    private let defaultsKey = "backgroundActivity.preferredEnabled"
    private let helperBundleId = "com.chiimagnus.macOS.SyncNosHelper"
    private var helperService: SMAppService { SMAppService.loginItem(identifier: helperBundleId) }

    // MARK: - State
    /// 线程安全的管理队列，用于保护启动状态
    private let stateQueue = DispatchQueue(label: "com.syncnos.backgroundActivity.state", qos: .userInitiated)
    /// 防止重复启动的状态标记（在线程安全队列中保护）
    private var _isLaunchingHelper: Bool = false

    var preferredEnabled: Bool {
        SharedDefaults.userDefaults.bool(forKey: defaultsKey)
    }

    var effectiveStatus: SMAppService.Status {
        helperService.status
    }

    var isHelperRunning: Bool {
        // 避免跨目标依赖：直接通过 bundle id 检测进程是否存在
        !NSRunningApplication.runningApplications(withBundleIdentifier: helperBundleId).isEmpty
    }

    /// 线程安全地获取和设置启动状态
    private var isLaunchingHelper: Bool {
        get {
            stateQueue.sync { _isLaunchingHelper }
        }
        set {
            stateQueue.sync { _isLaunchingHelper = newValue }
        }
    }
    
    // MARK: - Actions
    @discardableResult
    func enableAndLaunch() throws -> EnableOutcome {
        setPreferred(true)
        do {
            try helperService.register()
        } catch {
            DIContainer.shared.loggerService.info("SMAppService.register failed (user approval required): \(error.localizedDescription)")
            throw error
        }

        switch helperService.status {
        case .enabled:
            // 方案2：使用启动状态标记防止竞态条件
            if !isLaunchingHelper && !isHelperRunning {
                isLaunchingHelper = true
                launchHelperLocalIfNeeded(activates: false)
                // 启动操作是异步的，延迟重置状态标记
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    self?.isLaunchingHelper = false
                }
            }
            return .launched
        case .requiresApproval:
            // 按要求：打开系统设置登录项页，并交由上层弹窗提示
            SMAppService.openSystemSettingsLoginItems()
            return .requiresApprovalOpenedSettings
        default:
            // 未知或未注册等状态，一并引导到系统设置
            SMAppService.openSystemSettingsLoginItems()
            return .requiresApprovalOpenedSettings
        }
    }
    
    func disable() throws {
        setPreferred(false)

        // 强制终止正在运行的 Helper 进程
        if isHelperRunning {
            DIContainer.shared.loggerService.info("BackgroundActivityService: terminating running helper before disable")
            terminateHelper()
        }

        do {
            try helperService.unregister()
        } catch {
            DIContainer.shared.loggerService.warning("SMAppService.unregister failed: \(error.localizedDescription)")
            throw error
        }
    }
    
    func ensurePreferredStateOnLaunch() {
        let prefer = preferredEnabled
        let status = helperService.status
        if prefer && status == .notRegistered {
            do {
                try helperService.register()
            } catch {
                DIContainer.shared.loggerService.info("register on launch failed (user approval required): \(error.localizedDescription)")
            }
        }
        // 若已启用但 Helper 未在运行，则后台拉起一次
        // 方案2：使用启动状态标记防止竞态条件
        if helperService.status == .enabled && !isHelperRunning && !isLaunchingHelper {
            isLaunchingHelper = true
            launchHelperLocalIfNeeded(activates: false)
            // 启动操作是异步的，延迟重置状态标记
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.isLaunchingHelper = false
            }
        }
    }

    func terminateHelper() {
        guard isHelperRunning else { return }

        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: helperBundleId).first {
            let logger = DIContainer.shared.loggerService

            // 尝试优雅退出
            if app.terminate() {
                logger.info("BackgroundActivityService: sent terminate signal to helper")
            }

            // 5秒后检查是否仍在运行，若在则强制终止
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
                if !app.isTerminated, let runningApp = NSRunningApplication.runningApplications(withBundleIdentifier: self.helperBundleId).first {
                    if runningApp.forceTerminate() {
                        logger.warning("BackgroundActivityService: force terminated helper after 5s timeout")
                    } else {
                        logger.error("BackgroundActivityService: failed to force terminate helper")
                    }
                }
            }
        }
    }

    func launchHelperForHandoff() {
        // 方案2：使用启动状态标记防止竞态条件
        guard !isHelperRunning, !isLaunchingHelper else { return }

        let logger = DIContainer.shared.loggerService
        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("Library")
            .appendingPathComponent("LoginItems")
            .appendingPathComponent("SyncNosHelper.app")

        guard FileManager.default.fileExists(atPath: helperURL.path) else {
            logger.warning("BackgroundActivityService: helper not found at \(helperURL.path)")
            return
        }

        // 标记开始启动
        isLaunchingHelper = true
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("BackgroundActivityService: launched helper for handoff")

        // 启动操作是异步的，延迟重置状态标记
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.isLaunchingHelper = false
        }
    }
    
    // MARK: - Helpers
    private func setPreferred(_ newValue: Bool) {
        SharedDefaults.userDefaults.set(newValue, forKey: defaultsKey)
    }
    
    private func launchHelperLocalIfNeeded(activates: Bool) {
        // 方案2：使用启动状态标记防止竞态条件
        guard !isHelperRunning, !isLaunchingHelper else { return }

        let logger = DIContainer.shared.loggerService
        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("Library")
            .appendingPathComponent("LoginItems")
            .appendingPathComponent("SyncNosHelper.app")
        guard FileManager.default.fileExists(atPath: helperURL.path) else {
            logger.warning("BackgroundActivityService: helper not found at \(helperURL.path)")
            return
        }

        // 标记开始启动
        isLaunchingHelper = true
        let config = NSWorkspace.OpenConfiguration()
        config.activates = activates
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("BackgroundActivityService: launched helper, activates=\(activates)")

        // 启动操作是异步的，延迟重置状态标记
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.isLaunchingHelper = false
        }
    }
}


