import Foundation
import ServiceManagement

final class LoginItemService: LoginItemServiceProtocol {
    private let helperBundleIdentifier: String

    init(helperBundleIdentifier: String = "com.chiimagnus.macOS.LoginHelper") {
        self.helperBundleIdentifier = helperBundleIdentifier
    }

    func isRegistered() -> Bool {
        if #available(macOS 13.0, *) {
            let status = SMAppService.loginItem(identifier: helperBundleIdentifier).status
            return status != .notRegistered
        } else {
            // No reliable query API on older macOS; return false as conservative default
            return false
        }
    }

    func setEnabled(_ enabled: Bool) throws {
        if #available(macOS 13.0, *) {
            let loginItem = SMAppService.loginItem(identifier: helperBundleIdentifier)
            if enabled {
                try loginItem.register()
            } else {
                try loginItem.unregister()
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
}


