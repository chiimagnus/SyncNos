import Foundation
import ServiceManagement
import AppKit

/// 使用 SMAppService 管理 Helper Login Item（破坏式重构后实现 1b 策略）
final class BackgroundActivityService: BackgroundActivityServiceProtocol {
    private let defaultsKey = "backgroundActivity.preferredEnabled"
    private let helperBundleId = "com.chiimagnus.macOS.SyncNosHelper"
    private var helperService: SMAppService { SMAppService.loginItem(identifier: helperBundleId) }
    
    // MARK: - State
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
    
    // MARK: - Actions
    @discardableResult
    func enableAndLaunch() throws -> EnableOutcome {
        setPreferred(true)
        do {
            try helperService.register()
        } catch {
            DIContainer.shared.loggerService.error("SMAppService.register failed: \(error.localizedDescription)")
            throw error
        }
        
        switch helperService.status {
        case .enabled:
            launchHelperLocalIfNeeded(activates: false)
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
            DIContainer.shared.loggerService.error("SMAppService.unregister failed: \(error.localizedDescription)")
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
                DIContainer.shared.loggerService.error("register on launch failed: \(error.localizedDescription)")
            }
        }
        // 若已启用但 Helper 未在运行，则后台拉起一次
        if helperService.status == .enabled && !isHelperRunning {
            launchHelperLocalIfNeeded(activates: false)
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
        guard !isHelperRunning else { return }

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

        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("BackgroundActivityService: launched helper for handoff")
    }
    
    // MARK: - Helpers
    private func setPreferred(_ newValue: Bool) {
        SharedDefaults.userDefaults.set(newValue, forKey: defaultsKey)
    }
    
    private func launchHelperLocalIfNeeded(activates: Bool) {
        guard !isHelperRunning else { return }
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
        let config = NSWorkspace.OpenConfiguration()
        config.activates = activates
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("BackgroundActivityService: launched helper, activates=\(activates)")
    }
}


