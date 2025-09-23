import Foundation

// MARK: - Logger Service Implementation
class LoggerService: LoggerServiceProtocol {
    static let shared = LoggerService()

    private init() {
        // 在开发环境中默认为debug级别，生产环境中默认为info级别
        #if DEBUG
        self.currentLevel = .debug
        #else
        self.currentLevel = .info
        #endif
    }

    var currentLevel: LogLevel = .info

    func log(_ level: LogLevel, message: String, file: String = #file, function: String = #function, line: Int = #line) {
        // 只有当日志级别大于等于当前配置级别时才输出
        guard level >= currentLevel else { return }

        let fileName = (file as NSString).lastPathComponent
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let logMessage = "\(timestamp) [\(level.description)] \(fileName):\(line) \(function) - \(message)"

        // 输出到控制台
        print(logMessage)

        // TODO: 在生产环境中可以添加文件记录功能
        // 这里可以添加将日志写入文件的逻辑
    }

}