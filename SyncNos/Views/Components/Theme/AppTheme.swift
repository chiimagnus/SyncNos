import SwiftUI

enum HighlightColorUI {
    static func color(for index: Int, source: HighlightSource) -> Color {
        let def = HighlightColorScheme.definition(for: index, source: source)
        return color(fromNotionName: def.notionName)
    }

    static func color(fromNotionName name: String) -> Color {
        switch name {
        case "orange": return .orange
        case "green": return .green
        case "blue": return .blue
        case "yellow": return .yellow
        case "pink": return .pink
        case "purple": return .purple
        case "red": return .red
        case "mint": return .mint
        case "gray": return .gray
        default: return .gray
        }
    }
}
