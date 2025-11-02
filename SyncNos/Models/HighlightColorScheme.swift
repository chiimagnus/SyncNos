import Foundation

enum HighlightSource: String {
    case appleBooks
    case goodLinks
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
                HighlightColorDefinition(index: 5, notionName: "mint", displayName: "Mint")
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
            return HighlightColorDefinition(index: index, notionName: "mint", displayName: "Mint")
        case .appleBooks:
            return HighlightColorDefinition(index: index, notionName: "gray", displayName: "Gray")
        }
    }
}
