import Foundation

/// 核心 Notion 服务类，包含基础属性和初始化方法
class NotionServiceCore {
    let configStore: NotionConfigStoreProtocol
    let logger = DIContainer.shared.loggerService
    let apiBase = URL(string: "https://api.notion.com/v1/")!
    let notionVersion = "2022-06-28"

    // ISO8601 formatter for highlight timestamps when syncing to Notion
    static let isoDateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// 生成包含系统时区偏移的 ISO8601 字符串（用于 Notion date.start）
    /// 例如：2025-11-04T21:19:00+08:00
    static func localISODateString(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = .current
        return f.string(from: date)
    }

    /// Notion date 值：仅包含带偏移量的 start（推荐用于数据库属性，避免 UI 双重换算）
    static func makeNotionDateOffset(_ date: Date) -> [String: Any] {
        return [
            "start": localISODateString(date)
        ]
    }

    // 保留：如需 time_zone 组合再启用
    // static let isoLocalNoZoneFormatter: DateFormatter = { ... }()

    init(configStore: NotionConfigStoreProtocol) {
        self.configStore = configStore
    }
}
