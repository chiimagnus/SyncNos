import Foundation
import ServiceManagement

final class LoginItemService: LoginItemServiceProtocol {
    private let helperBundleIdentifier: String

    init(helperBundleIdentifier: String = "com.chiimagnus.macOS.LoginHelper") {
        self.helperBundleIdentifier = helperBundleIdentifier
    }

    func isRegistered() -> Bool {
        if #available(macOS 13.0, *) {
            // Prefer the new Ventura+ API: show enabled if main app is set to open at login.
            let mainStatus = SMAppService.mainApp.status
            if mainStatus != .notRegistered { return true }
            // Backward compatibility/migration: consider legacy helper registration as enabled.
            let helperStatus = SMAppService.loginItem(identifier: helperBundleIdentifier).status
            return helperStatus != .notRegistered
        } else {
            // No reliable query API on older macOS; return false as conservative default
            return false
        }
    }

    func setEnabled(_ enabled: Bool) throws {
        if #available(macOS 13.0, *) {
            // Ventura+: Register main app under "Open at Login" instead of background helper.
            if enabled {
                // Enable main app open-at-login
                try SMAppService.mainApp.register()
                // Clean up legacy background helper if it was previously registered
                let helper = SMAppService.loginItem(identifier: helperBundleIdentifier)
                if helper.status != .notRegistered {
                    // Ignore errors if already removed/not found
                    try? helper.unregister()
                }
            } else {
                // Disable both main app and legacy helper to ensure a clean state
                // Ignore errors if not registered
                try? SMAppService.mainApp.unregister()
                let helper = SMAppService.loginItem(identifier: helperBundleIdentifier)
                if helper.status != .notRegistered {
                    try? helper.unregister()
                }
            }
        } else {
            // Fallback for older macOS versions
            let cfId = helperBundleIdentifier as CFString
            let ok = SMLoginItemSetEnabled(cfId, enabled)
            if !ok {
                throw NSError(domain: "LoginItemService", code: 1, userInfo: [NSLocalizedDescriptionKey: "SMLoginItemSetEnabled failed"])
            }
        }
    }

    /// Migrate legacy background helper registration to main app "Open at Login" (Ventura+).
    func migrateToMainAppIfLegacyHelperEnabled() {
        if #available(macOS 13.0, *) {
            let mainStatus = SMAppService.mainApp.status
            let helper = SMAppService.loginItem(identifier: helperBundleIdentifier)
            let helperStatus = helper.status
            guard mainStatus == .notRegistered, helperStatus != .notRegistered else { return }
            // Best-effort migration; ignore errors if user intervention required
            try? SMAppService.mainApp.register()
            try? helper.unregister()
        }
    }
}


