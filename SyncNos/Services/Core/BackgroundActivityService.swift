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
        HelperLauncher.isHelperRunning()
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
            HelperLauncher.launchHelperIfNeeded(activates: false)
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
            HelperLauncher.launchHelperIfNeeded(activates: false)
        }
    }
    
    // MARK: - Helpers
    private func setPreferred(_ newValue: Bool) {
        SharedDefaults.userDefaults.set(newValue, forKey: defaultsKey)
    }
}


