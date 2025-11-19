import Foundation
import SwiftData

// MARK: - API Response Models

struct WeReadNotebookResponse: Codable {
    let books: [WeReadBookMetadata]
}

struct WeReadBookMetadata: Codable {
    let bookId: String
    let book: WeReadBookInfo
}

struct WeReadBookInfo: Codable {
    let bookId: String
    let title: String
    let author: String
    let cover: String
    let intro: String?
    let category: String?
}

struct WeReadHighlightResponse: Codable {
    let updated: [WeReadBookmark]?
}

struct WeReadBookmark: Codable {
    let bookmarkId: String
    let createTime: Int
    let markText: String
    let style: Int?
}

struct WeReadReviewResponse: Codable {
    let reviews: [WeReadReview]?
}

struct WeReadReview: Codable {
    let reviewId: String
    let review: WeReadReviewContent
}

struct WeReadReviewContent: Codable {
    let createTime: Int
    let content: String // The user's note
    let abstract: String? // The selected text
    let bookId: String
    let reviewId: String
}

// MARK: - SwiftData Models

@available(macOS 14.0, *)
@Model
final class WeReadBook {
    @Attribute(.unique) var bookId: String
    var title: String
    var author: String
    var coverURL: String
    var lastSyncTime: Date?
    
    @Relationship(deleteRule: .cascade, inverse: \WeReadHighlight.book)
    var highlights: [WeReadHighlight] = []
    
    init(bookId: String, title: String, author: String, coverURL: String) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.coverURL = coverURL
        self.lastSyncTime = nil
    }
}

@available(macOS 14.0, *)
@Model
final class WeReadHighlight {
    @Attribute(.unique) var bookmarkId: String
    var text: String
    var createTime: Date
    var note: String?
    var style: Int?
    
    var book: WeReadBook?
    
    init(bookmarkId: String, text: String, createTime: Date, note: String? = nil, style: Int? = nil) {
        self.bookmarkId = bookmarkId
        self.text = text
        self.createTime = createTime
        self.note = note
        self.style = style
    }
}

