import Foundation
import ServiceManagement

/// 使用 SMAppService 注册/撤销 Login Item Helper，用于系统级“允许在后台运行”
/// - 说明：
///   - Helper 的 Bundle ID：com.chiimagnus.macOS.SyncNosHelper
///   - 打开/关闭由系统管理；当首次注册时，可能需要用户在 系统设置 → 登录项 中授权
final class BackgroundActivityService: BackgroundActivityServiceProtocol {
    private let defaultsKey = "backgroundActivity.enabled"
    private let helperBundleId = "com.chiimagnus.macOS.SyncNosHelper"
    
    private var helperService: SMAppService {
        SMAppService.loginItem(identifier: helperBundleId)
    }
    
    // 以系统实际状态为准；仅当真正处于 .enabled 时才返回 true
    var isEnabled: Bool {
        helperService.status == .enabled
    }
    
    func setEnabled(_ enabled: Bool) {
        // 记录用户偏好（供下次启动时做幂等校正）
        SharedDefaults.userDefaults.set(enabled, forKey: defaultsKey)
        
        do {
            if enabled {
                try helperService.register()
                // 若需要用户操作，则引导到系统设置
                if helperService.status == .requiresApproval {
                    SMAppService.openSystemSettingsLoginItems()
                }
            } else {
                try helperService.unregister()
            }
        } catch {
            // 将失败记录到统一日志，不抛给上层以免造成 UI 抖动
            DIContainer.shared.loggerService.error("SMAppService register/unregister failed: \(error.localizedDescription)")
        }
    }
    
    /// 应用启动时调用：根据用户偏好与当前系统状态进行幂等校正
    func startIfEnabled() {
        let preferEnabled = SharedDefaults.userDefaults.bool(forKey: defaultsKey)
        let status = helperService.status
        if preferEnabled && status == .notRegistered {
            // 尝试注册一次（可能仍需用户在系统设置授权）
            do {
                try helperService.register()
            } catch {
                DIContainer.shared.loggerService.error("SMAppService register on launch failed: \(error.localizedDescription)")
            }
        }
    }
}


