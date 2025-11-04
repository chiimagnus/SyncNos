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

    init(configStore: NotionConfigStoreProtocol) {
        self.configStore = configStore
    }
}
