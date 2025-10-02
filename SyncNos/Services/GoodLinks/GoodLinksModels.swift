import Foundation

// MARK: - GoodLinks Models

struct GoodLinksLinkRow: Codable, Equatable {
    let id: String
    let url: String
    let originalURL: String?
    let title: String?
    let summary: String?
    let author: String?
    let readAt: Double
    let addedAt: Double
    let modifiedAt: Double
    let highlightTotal: Int?
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
