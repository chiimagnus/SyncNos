import Foundation
import AppKit

enum HelperLauncher {
    static func isHelperRunning() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: "com.chiimagnus.macOS.SyncNosHelper").isEmpty
    }
    
    static func launchHelperIfNeeded(activates: Bool = false) {
        guard !isHelperRunning() else { return }
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
        config.activates = activates
        NSWorkspace.shared.openApplication(at: helperURL, configuration: config, completionHandler: nil)
        logger.info("HelperLauncher: launched helper (if needed), activates=\(activates)")
    }
    
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


