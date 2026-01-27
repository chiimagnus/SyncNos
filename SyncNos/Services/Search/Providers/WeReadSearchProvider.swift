import Foundation

// MARK: - WeRead Search Provider

final class WeReadSearchProvider: GlobalSearchProvider {
    let source: ContentSource = .weRead

    private let cacheService: WeReadCacheServiceProtocol
    private let logger: LoggerServiceProtocol

    init(cacheService: WeReadCacheServiceProtocol, logger: LoggerServiceProtocol) {
        self.cacheService = cacheService
        self.logger = logger
    }

    func search(query: String, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let books = try await cacheService.getAllBooks()
                    var containersWithTextBlock = Set<String>()

                    var yielded = 0
                    for book in books {
                        if Task.isCancelled { break }
                        if yielded >= limit { break }

                        let highlights = try await cacheService.getHighlights(bookId: book.bookId)
                        for h in highlights {
                            if Task.isCancelled { break }
                            if yielded >= limit { break }

                            let best = bestMatch(bookmark: h, query: query)
                            guard let m = best else { continue }

                            let ts = h.timestamp.map { Date(timeIntervalSince1970: $0) }
                            let score = 1_000_000 + (m.matchCount * 1000) - m.compactness
                            continuation.yield(
                                GlobalSearchResult(
                                    source: .weRead,
                                    kind: .textBlock,
                                    containerId: book.bookId,
                                    containerTitle: book.title.isEmpty ? "未命名书籍" : book.title,
                                    containerSubtitle: book.author.isEmpty ? nil : book.author,
                                    blockId: h.highlightId,
                                    snippet: m.snippet,
                                    snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                    timestamp: ts,
                                    score: score
                                )
                            )
                            yielded += 1
                            containersWithTextBlock.insert(book.bookId)
                        }
                    }

                    // 仅标题/作者命中
                    for book in books where !containersWithTextBlock.contains(book.bookId) {
                        if Task.isCancelled { break }
                        let haystack = "\(book.title)\n\(book.author)"
                        guard let m = SearchTextMatcher.match(text: haystack, query: query, snippetLimit: 120) else { continue }
                        let score = 100_000 + (m.matchCount * 1000) - m.compactness
                        continuation.yield(
                            GlobalSearchResult(
                                source: .weRead,
                                kind: .titleOnly,
                                containerId: book.bookId,
                                containerTitle: book.title.isEmpty ? "未命名书籍" : book.title,
                                containerSubtitle: book.author.isEmpty ? nil : book.author,
                                blockId: nil,
                                snippet: m.snippet,
                                snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                timestamp: book.updatedAt,
                                score: score
                            )
                        )
                    }

                    continuation.finish()
                } catch {
                    logger.error("[WeReadSearch] failed: \(error.localizedDescription)")
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func bestMatch(bookmark: WeReadBookmark, query: String) -> SearchTextMatch? {
        var best: SearchTextMatch?

        if let m = SearchTextMatcher.match(text: bookmark.text, query: query) {
            best = m
        }
        if let note = bookmark.note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let m = SearchTextMatcher.match(text: note, query: query) {
                best = pickBetter(best, m)
            }
        }
        if !bookmark.reviewContents.isEmpty {
            for r in bookmark.reviewContents {
                if let m = SearchTextMatcher.match(text: r, query: query) {
                    best = pickBetter(best, m)
                }
            }
        }
        return best
    }

    private func pickBetter(_ a: SearchTextMatch?, _ b: SearchTextMatch) -> SearchTextMatch {
        guard let a else { return b }
        let scoreA = (a.matchCount * 1000) - a.compactness
        let scoreB = (b.matchCount * 1000) - b.compactness
        return scoreB > scoreA ? b : a
    }
}

