import Foundation
import OSLog

/// Unified application logger using Apple's `Logger` (OSLog) from the Swift logging kit.
/// Use `AppLogger.shared.log("message", level: .info)` or the convenience methods.
final class AppLogger {
    static let shared = AppLogger()

    private let logger: Logger

    private init(subsystem: String = Bundle.main.bundleIdentifier ?? "SyncBookNotes") {
        self.logger = Logger(subsystem: subsystem, category: "App")
    }

    enum Level {
        case debug, info, notice, warning, error
    }

    func log(_ message: String, level: Level = .info) {
        switch level {
        case .debug:
            logger.debug("\(message, privacy: .public)")
        case .info:
            logger.info("\(message, privacy: .public)")
        case .notice:
            logger.notice("\(message, privacy: .public)")
        case .warning:
            logger.warning("\(message, privacy: .public)")
        case .error:
            logger.error("\(message, privacy: .public)")
        }
    }

    // Convenience methods
    func debug(_ message: String) { log(message, level: .debug) }
    func info(_ message: String) { log(message, level: .info) }
    func notice(_ message: String) { log(message, level: .notice) }
    func warning(_ message: String) { log(message, level: .warning) }
    func error(_ message: String) { log(message, level: .error) }
}


