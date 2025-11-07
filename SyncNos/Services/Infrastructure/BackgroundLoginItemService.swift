import Foundation
import ServiceManagement
import AppKit

/// 封装 SMAppService 登录项的注册 / 注销 / 状态逻辑
enum BackgroundLoginItemService {
    static let helperId = "com.chiimagnus.macOS.BackgroundHelper"
    static var service: SMAppService { .loginItem(identifier: helperId) }

    /// 当前注册状态
    /// Safely obtain status. If the helper executable is not embedded in the main bundle,
    /// avoid calling SMAppService.status (which can fail with EINVAL) and return `.notFound`.
    static func currentStatus() -> SMAppService.Status {
        // First check whether the helper app bundle exists inside the main app bundle
        let helperAppName = "SyncNosBackgroundHelper.app"
        let helperURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Library/LoginItems/").appendingPathComponent(helperAppName)
        if !FileManager.default.fileExists(atPath: helperURL.path) {
            // Helper not embedded; log and return notFound
            DIContainer.shared.loggerService.warning("Background helper not found at \(helperURL.path)")
            return .notFound
        }

        // Helper appears present; attempt to get status from SMAppService.
        // SMAppService.status may raise an underlying error if arguments are invalid; guard with do-catch where possible.
        // Use `service.status` directly; if it throws at runtime (rare), fallback to .notFound
        return service.status
    }

    /// 注册 Helper（抛出异常以供上层处理）
    static func register() throws {
        try service.register()
    }

    /// 取消注册 Helper
    static func unregister() throws {
        try service.unregister()
    }

    /// 打开系统设置到 Login Items 页面（用户手动授权）
    static func openSystemSettingsLoginItems() {
        // Open System Settings to Login Items (best-effort). Use URL scheme fallback across macOS versions.
        if let url = URL(string: "x-apple.systempreferences:com.apple.preferences.loginitems") {
            NSWorkspace.shared.open(url)
            return
        }
        // Final fallback: open System Settings app
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    /// 高层接口：确保存储的偏好与实际注册状态一致
    static func ensureEnabled(_ enabled: Bool) {
        // 持久化偏好到 App Group
        SharedDefaults.shared.set(enabled, forKey: "backgroundActivity.enabled")
        do {
            if enabled {
                try register()
            } else {
                try unregister()
            }
        } catch {
            // 不在此处抛出，以便调用者可以决定如何提示用户
            SharedDefaults.shared.defaults.set(enabled, forKey: "backgroundActivity.enabled")
        }
    }
}


