import Foundation
import ServiceManagement

final class LoginItemService: LoginItemServiceProtocol {
    func isRegistered() -> Bool {
        // macOS 13+ only: reflect whether the main app is set to open at login
        return SMAppService.mainApp.status != .notRegistered
    }

    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}


