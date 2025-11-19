import Foundation
import SwiftData
import SwiftUI

@available(macOS 14.0, *)
@MainActor
final class WeReadDataService {
    static let shared = WeReadDataService()
    
    var modelContainer: ModelContainer?
    
    private init() {
        do {
            // Use a specific file in Application Support to avoid conflicts
            let schema = Schema([WeReadBook.self, WeReadHighlight.self])
            let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
            self.modelContainer = try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            print("Failed to create WeRead ModelContainer: \(error)")
        }
    }
    
    var context: ModelContext? {
        return modelContainer?.mainContext
    }
    
    // MARK: - CRUD
    
    func fetchAllBooks() -> [WeReadBook] {
        guard let context = context else { return [] }
        let descriptor = FetchDescriptor<WeReadBook>(sortBy: [SortDescriptor(\.lastSyncTime, order: .reverse)])
        do {
            return try context.fetch(descriptor)
        } catch {
            print("WeRead fetch books error: \(error)")
            return []
        }
    }
    
    func fetchBook(bookId: String) -> WeReadBook? {
        guard let context = context else { return nil }
        let descriptor = FetchDescriptor<WeReadBook>(predicate: #Predicate<WeReadBook> { $0.bookId == bookId })
        do {
            return try context.fetch(descriptor).first
        } catch {
            return nil
        }
    }
    
    func saveBook(_ bookInfo: WeReadBookInfo) -> WeReadBook {
        guard let context = context else { fatalError("Context missing") }
        
        if let existing = fetchBook(bookId: bookInfo.bookId) {
            existing.title = bookInfo.title
            existing.author = bookInfo.author
            existing.coverURL = bookInfo.cover
            return existing
        } else {
            let newBook = WeReadBook(
                bookId: bookInfo.bookId,
                title: bookInfo.title,
                author: bookInfo.author,
                coverURL: bookInfo.cover
            )
            context.insert(newBook)
            return newBook
        }
    }
    
    func saveHighlights(bookId: String, highlights: [WeReadBookmark], reviews: [WeReadReview]?) throws {
        guard let context = context else { return }
        guard let book = fetchBook(bookId: bookId) else { return }
        
        // Create map of existing highlights to update/avoid dups
        // For simplicity, we might delete all and recreate, or upsert. Upsert is better.
        
        // 1. Process bookmarks (highlights)
        for h in highlights {
            // Check if exists
            let hId = h.bookmarkId
            let text = h.markText
            let date = Date(timeIntervalSince1970: TimeInterval(h.createTime))
            
            // Find existing highlight in this book
            // Note: SwiftData relationship filtering can be tricky, iterating for now or better fetch
            if let existing = book.highlights.first(where: { $0.bookmarkId == hId }) {
                existing.text = text
                existing.style = h.style
                existing.createTime = date // Update time?
            } else {
                let newH = WeReadHighlight(bookmarkId: hId, text: text, createTime: date, style: h.style)
                newH.book = book
                context.insert(newH) // Relationship managed automatically if inverse set? usually explicit adding to array is safer
                // book.highlights.append(newH) // if not auto
            }
        }
        
        // 2. Process reviews (notes)
        // Reviews often link to a bookmark or are standalone?
        // In WeRead, reviews often map to a reviewId.
        // If a review is associated with a highlight (bookmark), we should merge note.
        // WeRead API structure: Review has `reviewId`, `abstract` (quoted text), `content` (note).
        // Often `reviewId` != `bookmarkId`.
        // Strategy: Treat reviews as highlights with notes.
        
        if let reviews = reviews {
            for r in reviews {
                let reviewId = r.reviewId
                let content = r.review.content
                let abstract = r.review.abstract ?? "[Image/No Text]"
                let date = Date(timeIntervalSince1970: TimeInterval(r.review.createTime))
                
                // Check if this review corresponds to an existing bookmark (by text match? weak)
                // Or treat as separate highlight type
                
                if let existing = book.highlights.first(where: { $0.bookmarkId == reviewId }) {
                    existing.note = content
                    existing.text = abstract
                } else {
                     let newH = WeReadHighlight(bookmarkId: reviewId, text: abstract, createTime: date, note: content)
                     newH.book = book
                     context.insert(newH)
                }
            }
        }
        
        book.lastSyncTime = Date()
        try context.save()
    }
    
    func deleteAll() {
         guard let context = context else { return }
         try? context.delete(model: WeReadBook.self)
         try? context.delete(model: WeReadHighlight.self)
    }
}

