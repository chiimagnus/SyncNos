import Foundation

// MARK: - Dedao Search Provider

final class DedaoSearchProvider: GlobalSearchProvider {
    let source: ContentSource = .dedao

    private let cacheService: DedaoCacheServiceProtocol
    private let logger: LoggerServiceProtocol

    init(cacheService: DedaoCacheServiceProtocol, logger: LoggerServiceProtocol) {
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

                        let notes = try await cacheService.getHighlights(bookId: book.bookId)
                        for n in notes {
                            if Task.isCancelled { break }
                            if yielded >= limit { break }

                            let text = n.effectiveNoteLine
                            let note = n.note
                            guard let m = bestMatch(text: text, note: note, query: query) else { continue }

                            let ts: Date? = {
                                let t = n.effectiveUpdateTime > 0 ? n.effectiveUpdateTime : n.effectiveCreateTime
                                return t > 0 ? Date(timeIntervalSince1970: TimeInterval(t)) : nil
                            }()

                            let score = 1_000_000 + (m.matchCount * 1000) - m.compactness
                            continuation.yield(
                                GlobalSearchResult(
                                    source: .dedao,
                                    kind: .textBlock,
                                    containerId: book.bookId,
                                    containerTitle: book.title.isEmpty ? "未命名书籍" : book.title,
                                    containerSubtitle: book.author.isEmpty ? nil : book.author,
                                    blockId: n.effectiveId,
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

                    for book in books where !containersWithTextBlock.contains(book.bookId) {
                        if Task.isCancelled { break }
                        let haystack = "\(book.title)\n\(book.author)"
                        guard let m = SearchTextMatcher.match(text: haystack, query: query, snippetLimit: 120) else { continue }
                        let score = 100_000 + (m.matchCount * 1000) - m.compactness
                        continuation.yield(
                            GlobalSearchResult(
                                source: .dedao,
                                kind: .titleOnly,
                                containerId: book.bookId,
                                containerTitle: book.title.isEmpty ? "未命名书籍" : book.title,
                                containerSubtitle: book.author.isEmpty ? nil : book.author,
                                blockId: nil,
                                snippet: m.snippet,
                                snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                timestamp: nil,
                                score: score
                            )
                        )
                    }

                    continuation.finish()
                } catch {
                    logger.error("[DedaoSearch] failed: \(error.localizedDescription)")
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func bestMatch(text: String, note: String?, query: String) -> SearchTextMatch? {
        var best: SearchTextMatch?
        if let m = SearchTextMatcher.match(text: text, query: query) {
            best = m
        }
        if let note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let m = SearchTextMatcher.match(text: note, query: query) {
                if let current = best {
                    let scoreCurrent = (current.matchCount * 1000) - current.compactness
                    let scoreNew = (m.matchCount * 1000) - m.compactness
                    if scoreNew > scoreCurrent { best = m }
                } else {
                    best = m
                }
            }
        }
        return best
    }
}
