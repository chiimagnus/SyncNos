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
}

struct GoodLinksHighlightRow: Codable, Equatable {
    let id: String
    let linkId: String
    let content: String
    let color: Int?
    let note: String?
    let time: Double
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
    case read = "read"

    var displayName: String {
        switch self {
        case .title: return "标题"
        case .highlightCount: return "高亮数量"
        case .added: return "添加时间"
        case .modified: return "修改时间"
        case .read: return "阅读时间"
        }
    }
}
