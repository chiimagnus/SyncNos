import SwiftUI

func ibooksColor(for style: Int) -> Color {
    switch style {
    case 0: return .orange
    case 1: return .green
    case 2: return .blue
    case 3: return .yellow
    case 4: return .pink
    case 5: return .purple
    default: return .gray
    }
}

func goodLinksColor(for code: Int) -> Color {
    switch code {
    case 0: return .yellow
    case 1: return .green
    case 2: return .blue
    case 3: return .red
    case 4: return .purple
    default: return .mint
    }
}

func dateString(from date: Date?, dateStyle: DateFormatter.Style = .short, timeStyle: DateFormatter.Style = .short) -> String? {
    guard let date = date else { return nil }
    let formatter = DateFormatter()
    formatter.dateStyle = dateStyle
    formatter.timeStyle = timeStyle
    return formatter.string(from: date)
}

func dateString(fromUnix ts: Double, localeId: String = "zh_CN") -> String {
    guard ts > 0 else { return "Unknown" }
    let date = Date(timeIntervalSince1970: ts)
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.locale = Locale(identifier: localeId)
    return formatter.string(from: date)
}

func isSuccessSyncMessage(_ message: String, keywords: [String]) -> Bool {
    keywords.contains { message.localizedCaseInsensitiveContains($0) }
}


