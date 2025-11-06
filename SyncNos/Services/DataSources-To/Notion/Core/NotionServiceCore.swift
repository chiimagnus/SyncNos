import Foundation

/// 核心 Notion 服务类，包含基础属性和初始化方法
class NotionServiceCore {
    let configStore: NotionConfigStoreProtocol
    let logger = DIContainer.shared.loggerService
    let apiBase = URL(string: "https://api.notion.com/v1/")!
    let notionVersion = "2022-06-28"

    // ISO8601 formatter for highlight timestamps when syncing to Notion (UTC)
    static let isoDateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    // ISO8601 formatter for system timezone when syncing to Notion
    static let systemTimeZoneIsoDateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withTimeZone]
        f.timeZone = TimeZone.current  // 使用系统时区
        return f
    }()

    // Date formatter for Unix timestamps with system timezone
    static let systemTimeZoneDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZZZZZ"
        f.timeZone = TimeZone.current  // 使用系统时区
        return f
    }()

    init(configStore: NotionConfigStoreProtocol) {
        self.configStore = configStore
    }
}
