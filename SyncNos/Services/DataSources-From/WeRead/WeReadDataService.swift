import Foundation
import SwiftData

/// WeRead SwiftData 数据访问服务实现
@MainActor
final class WeReadDataService: WeReadDataServiceProtocol {
    private let container: ModelContainer
    private var context: ModelContext {
        ModelContext(container)
    }

    private let logger: LoggerServiceProtocol

    init(container: ModelContainer, logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.container = container
        self.logger = logger
    }

    // MARK: - Books

    func upsertBooks(from notebooks: [WeReadNotebook]) throws -> [WeReadBookListItem] {
        guard !notebooks.isEmpty else { return [] }
        let ctx = context

        var result: [WeReadBookListItem] = []
        result.reserveCapacity(notebooks.count)

        for nb in notebooks {
            let existing = fetchBookById(nb.bookId, in: ctx)
            let createdDate = nb.createdTimestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let updatedDate = nb.updatedTimestamp.flatMap { Date(timeIntervalSince1970: $0) }

            if let book = existing {
                book.title = nb.title
                book.author = nb.author ?? ""
                book.coverUrl = nb.cover
                book.category = nb.category
                book.createdAt = book.createdAt ?? createdDate
                book.updatedAt = updatedDate ?? book.updatedAt
                result.append(WeReadBookListItem(from: book))
            } else {
                let book = WeReadBook(
                    bookId: nb.bookId,
                    title: nb.title,
                    author: nb.author ?? "",
                    coverUrl: nb.cover,
                    category: nb.category,
                    createdAt: createdDate,
                    updatedAt: updatedDate
                )
                ctx.insert(book)
                result.append(WeReadBookListItem(from: book))
            }
        }

        do {
            try ctx.save()
        } catch {
            logger.error("[WeReadData] Failed to save books: \(error.localizedDescription)")
            throw error
        }

        return result
    }

    func upsertHighlights(
        for bookId: String,
        bookmarks: [WeReadBookmark],
        reviews: [WeReadReview]
    ) throws {
        let ctx = context

        guard let book = fetchBookById(bookId, in: ctx) else {
            logger.warning("[WeReadData] upsertHighlights: book not found for id=\(bookId)")
            return
        }

        // 先构建当前已有高亮的索引表
        var existingById: [String: WeReadHighlight] = [:]
        for h in book.highlights {
            existingById[h.highlightId] = h
        }

        // 合并 bookmarks
        for bm in bookmarks {
            let createdDate = bm.timestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let highlightId = bm.highlightId

            let existing = existingById[highlightId]
            if let h = existing {
                h.text = bm.text
                h.note = bm.note
                h.colorIndex = bm.colorIndex
                h.createdAt = h.createdAt ?? createdDate
                h.chapterTitle = bm.chapterTitle
                h.book = book
            } else {
                let h = WeReadHighlight(
                    highlightId: highlightId,
                    book: book,
                    text: bm.text,
                    note: bm.note,
                    colorIndex: bm.colorIndex,
                    createdAt: createdDate,
                    modifiedAt: nil,
                    chapterTitle: bm.chapterTitle,
                    location: nil,
                    remoteHash: nil
                )
                ctx.insert(h)
                book.highlights.append(h)
                existingById[highlightId] = h
            }
        }

        // 将 review 作为带 note 的“虚拟高亮”附加到列表末尾（以 reviewId 作为 highlightId）
        for rv in reviews {
            let createdDate = rv.timestamp.flatMap { Date(timeIntervalSince1970: $0) }
            let highlightId = "review-\(rv.reviewId)"
            if let existing = existingById[highlightId] {
                existing.text = rv.content
                existing.note = rv.content
                existing.createdAt = existing.createdAt ?? createdDate
                existing.book = book
            } else {
                let h = WeReadHighlight(
                    highlightId: highlightId,
                    book: book,
                    text: rv.content,
                    note: rv.content,
                    colorIndex: nil,
                    createdAt: createdDate,
                    modifiedAt: nil,
                    chapterTitle: nil,
                    location: nil,
                    remoteHash: nil
                )
                ctx.insert(h)
                book.highlights.append(h)
                existingById[highlightId] = h
            }
        }

        do {
            try ctx.save()
        } catch {
            logger.error("[WeReadData] Failed to save highlights for bookId=\(bookId): \(error.localizedDescription)")
            throw error
        }
    }

    func fetchBooks() throws -> [WeReadBookListItem] {
        let ctx = context
        let descriptor = FetchDescriptor<WeReadBook>()

        let books = try ctx.fetch(descriptor)
        return books.map { WeReadBookListItem(from: $0) }
    }

    func fetchHighlights(
        for bookId: String,
        sortField: HighlightSortField,
        ascending: Bool,
        noteFilter: Bool,
        selectedStyles: [Int]?
    ) throws -> [WeReadHighlight] {
        let ctx = context

        let bookPredicate = #Predicate<WeReadHighlight> { $0.book?.bookId == bookId }
        var predicates: [Predicate<WeReadHighlight>] = [bookPredicate]

        if noteFilter {
            let hasNote = #Predicate<WeReadHighlight> { h in
                if let note = h.note {
                    return !note.isEmpty
                }
                return false
            }
            predicates.append(hasNote)
        }

        if let styles = selectedStyles, !styles.isEmpty {
            let set = Set(styles)
            let stylePredicate = #Predicate<WeReadHighlight> { h in
                if let color = h.colorIndex {
                    return set.contains(color)
                }
                return false
            }
            predicates.append(stylePredicate)
        }

        let compound = predicates.reduce(#Predicate<WeReadHighlight> { _ in true }) { partial, next in
            #Predicate<WeReadHighlight> { h in
                partial.evaluate(h) && next.evaluate(h)
            }
        }

        let sortDescriptor: SortDescriptor<WeReadHighlight>
        switch sortField {
        case .created:
            sortDescriptor = SortDescriptor(\.createdAt, order: ascending ? .forward : .reverse)
        case .modified:
            sortDescriptor = SortDescriptor(\.modifiedAt, order: ascending ? .forward : .reverse)
        }

        let descriptor = FetchDescriptor<WeReadHighlight>(
            predicate: compound,
            sortBy: [sortDescriptor]
        )

        return try ctx.fetch(descriptor)
    }

    // MARK: - Private helpers

    private func fetchBookById(_ bookId: String, in context: ModelContext) -> WeReadBook? {
        let predicate = #Predicate<WeReadBook> { $0.bookId == bookId }
        let descriptor = FetchDescriptor<WeReadBook>(predicate: predicate, fetchLimit: 1)
        return try? context.fetch(descriptor).first
    }
}


