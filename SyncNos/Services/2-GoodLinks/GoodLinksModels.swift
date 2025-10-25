import Foundation

// MARK: - GoodLinks Models

struct GoodLinksLinkRow: Codable, Equatable {
    let id: String
    let url: String
    let originalURL: String?
    let title: String?
    let summary: String?
    let author: String?
    let tags: String?
    let starred: Bool
    let readAt: Double
    let addedAt: Double
    let modifiedAt: Double
    let highlightTotal: Int?

    // MARK: - Derived
    var tagsArray: [String] {
        GoodLinksTagParser.parseTagsString(tags)
    }

    var tagsFormatted: String {
        GoodLinksTagParser.formatTagsWithSemicolon(tags)
    }

    // Deeplink to open the link in GoodLinks app
    var openInGoodLinksURLString: String {
        "goodlinks://x-callback-url/open?id=\(id)"
    }
}

struct GoodLinksHighlightRow: Codable, Equatable {
    let id: String
    let linkId: String
    let content: String
    let color: Int?
    let note: String?
    let time: Double

    // Deeplink to open the specific highlight in GoodLinks app
    // The highlight id contains a '#' fragment which must be percent-encoded in query
    var openInGoodLinksHighlightURLString: String {
        let forbidden = CharacterSet(charactersIn: "&=?#")
        let allowed = CharacterSet.urlQueryAllowed.subtracting(forbidden)
        let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
        return "goodlinks://x-callback-url/open-highlight?id=\(encoded)"
    }
}

struct GoodLinksLinkHighlightCount: Equatable {
    let linkId: String
    let count: Int
}

struct GoodLinksContentRow: Codable, Equatable {
    let id: String
    let content: String?
    let wordCount: Int
    let videoDuration: Int?
}

// MARK: - Sorting
enum GoodLinksSortKey: String, CaseIterable {
    case title = "title"
    case highlightCount = "highlightCount"
    case added = "added"
    case modified = "modified"
    case lastSync = "lastSync"

    var displayName: String {
        switch self {
        case .title: return NSLocalizedString("Title", comment: "GoodLinks sort option")
        case .highlightCount: return NSLocalizedString("Highlight Count", comment: "GoodLinks sort option")
        case .added: return NSLocalizedString("Added Time", comment: "GoodLinks sort option")
        case .modified: return NSLocalizedString("Modified Time", comment: "GoodLinks sort option")
        case .lastSync: return NSLocalizedString("Last Sync Time", comment: "GoodLinks sort option")
        }
    }
}
