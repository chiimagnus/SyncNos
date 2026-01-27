import Foundation

// MARK: - Apple Books Search Provider

final class AppleBooksSearchProvider: GlobalSearchProvider {
    let source: ContentSource = .appleBooks

    private let databaseService: DatabaseServiceProtocol
    private let bookmarkStore: BookmarkStoreProtocol
    private let logger: LoggerServiceProtocol

    init(
        databaseService: DatabaseServiceProtocol,
        bookmarkStore: BookmarkStoreProtocol,
        logger: LoggerServiceProtocol
    ) {
        self.databaseService = databaseService
        self.bookmarkStore = bookmarkStore
        self.logger = logger
    }

    func search(query: String, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let url = bookmarkStore.restore() else {
                        continuation.finish()
                        return
                    }
                    _ = bookmarkStore.startAccessing(url: url)

                    let root = DatabasePathHelper.determineDatabaseRoot(from: url.path)
                    let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
                    let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

                    guard let annotationDB = SQLiteFileLocator.latestSQLiteFile(in: annotationDir),
                          let booksDB = SQLiteFileLocator.latestSQLiteFile(in: booksDir) else {
                        continuation.finish()
                        return
                    }

                    let annotationSession = try databaseService.makeReadOnlySession(dbPath: annotationDB)
                    defer { annotationSession.close() }
                    let booksSession = try databaseService.makeReadOnlySession(dbPath: booksDB)
                    defer { booksSession.close() }

                    let rows = try annotationSession.searchHighlights(query: query, limit: limit)
                    if Task.isCancelled {
                        continuation.finish()
                        return
                    }

                    let assetIds = Array(Set(rows.map { $0.assetId }))
                    let books = try booksSession.fetchBooks(assetIds: assetIds)
                    var bookMap: [String: BookRow] = [:]
                    bookMap.reserveCapacity(books.count)
                    for b in books {
                        bookMap[b.assetId] = b
                    }

                    var containersWithTextBlock = Set<String>()

                    for row in rows {
                        if Task.isCancelled { break }

                        guard let best = bestMatch(text: row.text, note: row.note, query: query) else { continue }
                        let book = bookMap[row.assetId]
                        let title = book?.title.isEmpty == false ? (book?.title ?? "") : "未命名书籍"
                        let author = book?.author.isEmpty == false ? (book?.author ?? "") : nil

                        let score = 1_000_000 + (best.matchCount * 1000) - best.compactness
                        let ts = row.modified ?? row.dateAdded
                        let result = GlobalSearchResult(
                            source: .appleBooks,
                            kind: .textBlock,
                            containerId: row.assetId,
                            containerTitle: title,
                            containerSubtitle: author,
                            blockId: row.uuid,
                            snippet: best.snippet,
                            snippetMatchRangesUTF16: best.snippetMatchRangesUTF16,
                            timestamp: ts,
                            score: score
                        )
                        containersWithTextBlock.insert(row.assetId)
                        continuation.yield(result)
                    }

                    // 仅标题/作者命中（仅在该书没有任何 textBlock 命中时才返回）
                    for b in books where !containersWithTextBlock.contains(b.assetId) {
                        if Task.isCancelled { break }
                        let haystack = "\(b.title)\n\(b.author)"
                        guard let m = SearchTextMatcher.match(text: haystack, query: query, snippetLimit: 120) else { continue }
                        let title = b.title.isEmpty ? "未命名书籍" : b.title
                        let author = b.author.isEmpty ? nil : b.author
                        let score = 100_000 + (m.matchCount * 1000) - m.compactness
                        continuation.yield(
                            GlobalSearchResult(
                                source: .appleBooks,
                                kind: .titleOnly,
                                containerId: b.assetId,
                                containerTitle: title,
                                containerSubtitle: author,
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
                    logger.error("[AppleBooksSearch] failed: \(error.localizedDescription)")
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
                    if scoreNew > scoreCurrent {
                        best = m
                    }
                } else {
                    best = m
                }
            }
        }
        return best
    }
}

