import Foundation
import AppKit

enum HelperLauncher {
    static func launchHelperForHandoff() {
        let logger = DIContainer.shared.loggerService
        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("Library")
            .appendingPathComponent("LoginItems")
            .appendingPathComponent("SyncNosHelper.app")
        guard FileManager.default.fileExists(atPath: helperURL.path) else {
            logger.warning("HelperLauncher: helper not found at \(helperURL.path)")
            return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("HelperLauncher: launched helper for background handoff")
    }
}


