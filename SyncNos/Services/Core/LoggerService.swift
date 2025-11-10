import Foundation
@preconcurrency import Combine
import AppKit
import os.log

// MARK: - Logger Service Implementation
final class LoggerService: LoggerServiceProtocol {
    static let shared = LoggerService()

    private let subject = PassthroughSubject<LogEntry, Never>()
    var logPublisher: AnyPublisher<LogEntry, Never> { subject.eraseToAnyPublisher() }

    private var storedLogs: [LogEntry] = []

    // 系统日志记录器
    private let osLog = OSLog(subsystem: "com.chiimagnus.macOS.SyncNos", category: "general")

    private init() {
        // 在开发环境中默认为debug级别，生产环境中默认为info级别
        #if DEBUG
        self.currentLevel = .debug
        #else
        self.currentLevel = .info
        #endif
    }

    var currentLevel: LogLevel = .info

    func getAllLogs() -> [LogEntry] {
        return storedLogs
    }

    func log(_ level: LogLevel, message: String, file: String = #file, function: String = #function, line: Int = #line) {
        // 只有当日志级别大于等于当前配置级别时才输出
        guard level >= currentLevel else { return }

        let fileName = (file as NSString).lastPathComponent
        let timestamp = Date()
        let entry = LogEntry(id: UUID(), timestamp: timestamp, level: level, message: message, file: fileName, function: function, line: line)

        // 存储内存中
        storedLogs.append(entry)

        // 通过 publisher 发布
        subject.send(entry)

        // 输出到系统日志（os_log）
        let logMessage = "[\(fileName):\(line)] \(message)"
        let osLogType: OSLogType = {
            switch level {
            case .debug: return .debug
            case .info: return .info
            case .warning: return .default
            case .error: return .error
            }
        }()
        os_log("%{public}@", log: osLog, type: osLogType, logMessage)
    }

    func clearLogs() {
        storedLogs.removeAll()
        // 发送一个 special empty entry is not necessary; UI will clear by calling getAllLogs
    }

    func exportLogs(to url: URL) throws {
        var lines: [String] = []
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        for e in storedLogs {
            let time = formatter.string(from: e.timestamp)
            let line = "\(time) [\(e.level.description)] \(e.file):\(e.line) \(e.function) - \(e.message)"
            lines.append(line)
        }
        let content = lines.joined(separator: "\n")
        try content.write(to: url, atomically: true, encoding: .utf8)
    }
}

// MARK: - Sendable Conformance
extension LoggerService: @unchecked Sendable {}