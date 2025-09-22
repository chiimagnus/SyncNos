import Foundation

// MARK: - Types

struct Highlight: Codable {
    let uuid: String
    let text: String
    let note: String?
    let style: Int?
    let dateAdded: Date?
    let modified: Date?
    let location: String?
}

struct BookExport: Codable {
    let bookId: String
    let authorName: String
    let bookTitle: String
    let ibooksURL: String
    let highlights: [Highlight]
}

struct HighlightRow { 
    let assetId: String
    let uuid: String
    let text: String 
    let note: String?
    let style: Int?
    let dateAdded: Date?
    let modified: Date?
    let location: String?
}

struct BookRow { 
    let assetId: String
    let author: String
    let title: String 
}

struct Filters { 
    let bookSubstrings: [String]
    let authorSubstrings: [String]
    let assetIds: [String] 
}

// Lightweight model for listing books without loading all highlights
struct BookListItem: Codable, Equatable {
    let bookId: String
    let authorName: String
    let bookTitle: String
    let ibooksURL: String
    let highlightCount: Int
}

// Aggregated highlight count per asset/book
struct AssetHighlightCount {
    let assetId: String
    let count: Int
}