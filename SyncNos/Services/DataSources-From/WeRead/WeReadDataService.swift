import Foundation

/// WeRead 数据访问服务实现
final class WeReadDataService: WeReadDataServiceProtocol {
    private let store: WeReadStore
    private let logger: LoggerServiceProtocol

    init(store: WeReadStore, logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.store = store
        self.logger = logger
    }

    // MARK: - Books

    func upsertBooks(from notebooks: [WeReadNotebook]) throws -> [WeReadBookListItem] {
        guard !notebooks.isEmpty else { return [] }

        var booksToUpsert: [WeReadBook] = []
        booksToUpsert.reserveCapacity(notebooks.count)
        
        for nb in notebooks {
            let existing = store.getBook(id: nb.bookId)
            let createdDate = nb.createdTimestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let updatedDate = nb.updatedTimestamp.flatMap { Date(timeIntervalSince1970: $0) }
            
            var book: WeReadBook
            if var existingBook = existing {
                existingBook.title = nb.title
                existingBook.author = nb.author ?? ""
                existingBook.coverUrl = nb.cover
                existingBook.category = nb.category
                existingBook.createdAt = existingBook.createdAt ?? createdDate
                existingBook.updatedAt = updatedDate ?? existingBook.updatedAt
                book = existingBook
            } else {
                book = WeReadBook(
                    bookId: nb.bookId,
                    title: nb.title,
                    author: nb.author ?? "",
                    coverUrl: nb.cover,
                    category: nb.category,
                    createdAt: createdDate,
                    updatedAt: updatedDate
                )
            }
            booksToUpsert.append(book)
        }
        
        store.upsertBooks(booksToUpsert)
        
        return booksToUpsert.map { WeReadBookListItem(from: $0) }
    }

    func upsertHighlights(
        for bookId: String,
        bookmarks: [WeReadBookmark],
        reviews: [WeReadReview]
    ) throws {
        guard var book = store.getBook(id: bookId) else {
            logger.warning("[WeReadData] upsertHighlights: book not found for id=\(bookId)")
            return
        }
        
        // Index existing highlights
        var existingById: [String: WeReadHighlight] = [:]
        for h in book.highlights {
            existingById[h.highlightId] = h
        }
        
        // Merge bookmarks
        for bm in bookmarks {
            let createdDate = bm.timestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let highlightId = bm.highlightId
            
            if var h = existingById[highlightId] {
                h.text = bm.text
                h.note = bm.note
                h.colorIndex = bm.colorIndex
                h.createdAt = h.createdAt ?? createdDate
                h.chapterTitle = bm.chapterTitle
                h.bookId = bookId
                existingById[highlightId] = h
            } else {
                let h = WeReadHighlight(
                    highlightId: highlightId,
                    bookId: bookId,
                    text: bm.text,
                    note: bm.note,
                    colorIndex: bm.colorIndex,
                    createdAt: createdDate,
                    modifiedAt: nil,
                    chapterTitle: bm.chapterTitle,
                    location: nil,
                    remoteHash: nil
                )
                existingById[highlightId] = h
            }
        }
        
        // Merge reviews
        for rv in reviews {
            let createdDate = rv.timestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let highlightId = "review-\(rv.reviewId)"
            
            if var h = existingById[highlightId] {
                h.text = rv.content
                h.note = rv.content
                h.createdAt = h.createdAt ?? createdDate
                h.bookId = bookId
                existingById[highlightId] = h
            } else {
                let h = WeReadHighlight(
                    highlightId: highlightId,
                    bookId: bookId,
                    text: rv.content,
                    note: rv.content,
                    colorIndex: nil,
                    createdAt: createdDate,
                    modifiedAt: nil,
                    chapterTitle: nil,
                    location: nil,
                    remoteHash: nil
                )
                existingById[highlightId] = h
            }
        }
        
        book.highlights = Array(existingById.values)
        store.upsertBook(book)
    }

    func fetchBooks() throws -> [WeReadBookListItem] {
        return store.getAllBooks().map { WeReadBookListItem(from: $0) }
    }

    func fetchHighlights(
        for bookId: String,
        sortField: HighlightSortField,
        ascending: Bool,
        noteFilter: Bool,
        selectedStyles: [Int]?
    ) throws -> [WeReadHighlight] {
        guard let book = store.getBook(id: bookId) else { return [] }
        
        let stylesSet: Set<Int>? = (selectedStyles?.isEmpty == false) ? Set(selectedStyles!) : nil
        
        var highlights = book.highlights.filter { h in
            (!noteFilter || ((h.note ?? "").isEmpty == false))
            && (stylesSet == nil || ((h.colorIndex != nil) && stylesSet!.contains(h.colorIndex!)))
        }
        
        highlights.sort { h1, h2 in
            let d1: Date?
            let d2: Date?
            switch sortField {
            case .created:
                d1 = h1.createdAt
                d2 = h2.createdAt
            case .modified:
                d1 = h1.modifiedAt
                d2 = h2.modifiedAt
            }
            
            // Handle optional dates
            if let date1 = d1, let date2 = d2 {
                return ascending ? date1 < date2 : date1 > date2
            }
            if d1 != nil { return ascending ? false : true } // d1 exists, d2 nil -> d1 is "larger"? 
            // Usually: nil is "oldest" or "undefined". 
            // If ascending, nil < date. 
            // If descending, date > nil.
            if d1 == nil && d2 == nil { return false }
            
            if ascending {
                // nil comes first
                return d1 == nil
            } else {
                // nil comes last
                return d2 == nil
            }
        }
        
        return highlights
    }
}
