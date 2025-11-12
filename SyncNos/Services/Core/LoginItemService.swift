import Foundation
import ServiceManagement

final class LoginItemService: LoginItemServiceProtocol {
    func isRegistered() -> Bool {
        // macOS 13+ only: reflect whether the main app is set to open at login
        // Only return true when status is .enabled (successfully registered and eligible to run)
        // Other states (.notRegistered, .requiresApproval, .notFound) should return false
        return SMAppService.mainApp.status == .enabled
    }

    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}


