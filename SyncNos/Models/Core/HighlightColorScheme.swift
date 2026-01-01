import Foundation

enum HighlightSource: String {
    case appleBooks
    case goodLinks
    case weRead
    case dedao
    case chats
}

struct HighlightColorDefinition {
    let index: Int
    let notionName: String
    let displayName: String
}

enum HighlightColorScheme {
    static func allDefinitions(for source: HighlightSource) -> [HighlightColorDefinition] {
        switch source {
        case .appleBooks:
            return [
                HighlightColorDefinition(index: 0, notionName: "orange", displayName: "Orange"),
                HighlightColorDefinition(index: 1, notionName: "green", displayName: "Green"),
                HighlightColorDefinition(index: 2, notionName: "blue", displayName: "Blue"),
                HighlightColorDefinition(index: 3, notionName: "yellow", displayName: "Yellow"),
                HighlightColorDefinition(index: 4, notionName: "pink", displayName: "Pink"),
                HighlightColorDefinition(index: 5, notionName: "purple", displayName: "Purple")
            ]
        case .goodLinks:
            return [
                HighlightColorDefinition(index: 0, notionName: "yellow", displayName: "Yellow"),
                HighlightColorDefinition(index: 1, notionName: "green", displayName: "Green"),
                HighlightColorDefinition(index: 2, notionName: "blue", displayName: "Blue"),
                HighlightColorDefinition(index: 3, notionName: "red", displayName: "Red"),
                HighlightColorDefinition(index: 4, notionName: "purple", displayName: "Purple"),
                // Notion 不支持 mint，使用 brown 替代
                HighlightColorDefinition(index: 5, notionName: "brown", displayName: "Brown")
            ]
        case .weRead:
            return [
                HighlightColorDefinition(index: 0, notionName: "red", displayName: "Red"),
                HighlightColorDefinition(index: 1, notionName: "purple", displayName: "Purple"),
                HighlightColorDefinition(index: 2, notionName: "blue", displayName: "Blue"),
                HighlightColorDefinition(index: 3, notionName: "green", displayName: "Green"),
                HighlightColorDefinition(index: 4, notionName: "yellow", displayName: "Yellow")
            ]
        case .dedao:
            // 得到不提供高亮颜色信息，使用默认橙色
            return [
                HighlightColorDefinition(index: 0, notionName: "orange", displayName: "Default")
            ]
        case .chats:
            // Chats 颜色定义：根据消息方向区分
            // 0 = 我发送 (blue), 1 = 对方发送 (green), 2 = 系统消息 (gray)
            return [
                HighlightColorDefinition(index: 0, notionName: "blue", displayName: "From Me"),
                HighlightColorDefinition(index: 1, notionName: "green", displayName: "From Others"),
                HighlightColorDefinition(index: 2, notionName: "gray", displayName: "System")
            ]
        }
    }

    static func definition(for index: Int, source: HighlightSource) -> HighlightColorDefinition {
        let defs = allDefinitions(for: source)
        if let def = defs.first(where: { $0.index == index }) {
            return def
        }
        // Fallbacks align with previous behavior
        switch source {
        case .goodLinks:
            // Notion 不支持 mint，使用 brown 替代
            return HighlightColorDefinition(index: index, notionName: "brown", displayName: "Brown")
        case .appleBooks:
            return HighlightColorDefinition(index: index, notionName: "gray", displayName: "Gray")
        case .weRead:
            return HighlightColorDefinition(index: index, notionName: "gray", displayName: "Gray")
        case .dedao:
            return HighlightColorDefinition(index: index, notionName: "orange", displayName: "Default")
        case .chats:
            return HighlightColorDefinition(index: index, notionName: "gray", displayName: "Unknown")
        }
    }
}
