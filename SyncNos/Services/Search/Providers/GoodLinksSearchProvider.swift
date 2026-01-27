import Foundation

// MARK: - GoodLinks Search Provider

final class GoodLinksSearchProvider: GlobalSearchProvider {
    let source: ContentSource = .goodLinks

    private let goodLinksService: GoodLinksDatabaseServiceExposed
    private let webArticleCacheService: WebArticleCacheServiceProtocol
    private let logger: LoggerServiceProtocol

    init(
        goodLinksService: GoodLinksDatabaseServiceExposed,
        webArticleCacheService: WebArticleCacheServiceProtocol,
        logger: LoggerServiceProtocol
    ) {
        self.goodLinksService = goodLinksService
        self.webArticleCacheService = webArticleCacheService
        self.logger = logger
    }

    func search(query: String, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let dbPath = goodLinksService.resolveDatabasePath()
                    let session = try goodLinksService.makeReadOnlySession(dbPath: dbPath)
                    defer { session.close() }

                    // 先搜高亮/笔记（SQLite LIKE）
                    let highlightRows = try session.searchHighlights(query: query, limit: limit)
                    if Task.isCancelled {
                        continuation.finish()
                        return
                    }

                    let links = try session.fetchRecentLinks(limit: 0)
                    var linkMap: [String: GoodLinksLinkRow] = [:]
                    linkMap.reserveCapacity(links.count)
                    for link in links {
                        linkMap[link.id] = link
                    }

                    var containersWithTextBlock = Set<String>()
                    for h in highlightRows {
                        if Task.isCancelled { break }

                        guard let best = bestMatch(text: h.content, note: h.note, query: query) else { continue }
                        let link = linkMap[h.linkId]
                        let title = (link?.title?.isEmpty == false ? link?.title : nil) ?? link?.url ?? "未命名文章"
                        let subtitle = (link?.author?.isEmpty == false ? link?.author : nil) ?? hostFromURL(link?.url)
                        let ts = Date(timeIntervalSince1970: h.time)
                        let score = 1_000_000 + (best.matchCount * 1000) - best.compactness

                        continuation.yield(
                            GlobalSearchResult(
                                source: .goodLinks,
                                kind: .textBlock,
                                containerId: h.linkId,
                                containerTitle: title,
                                containerSubtitle: subtitle,
                                blockId: h.id,
                                snippet: best.snippet,
                                snippetMatchRangesUTF16: best.snippetMatchRangesUTF16,
                                timestamp: ts,
                                score: score
                            )
                        )
                        containersWithTextBlock.insert(h.linkId)
                    }

                    // 再搜已缓存的正文 textContent（仅尝试有限数量，避免全量扫描导致卡顿）
                    let maxArticleScan = min(links.count, 120)
                    if maxArticleScan > 0 {
                        for link in links.prefix(maxArticleScan) {
                            if Task.isCancelled { break }
                            guard let cached = try await webArticleCacheService.getArticle(url: link.url) else { continue }
                            guard let text = cached.textContent, !text.isEmpty else { continue }
                            guard let m = SearchTextMatcher.match(text: text, query: query, snippetLimit: 200) else { continue }

                            let title = (link.title?.isEmpty == false ? link.title : nil) ?? link.url
                            let subtitle = (link.author?.isEmpty == false ? link.author : nil) ?? hostFromURL(link.url)
                            let score = 900_000 + (m.matchCount * 1000) - m.compactness
                            let blockId = "article:\(abs(link.url.hashValue)):\(m.compactness)"

                            continuation.yield(
                                GlobalSearchResult(
                                    source: .goodLinks,
                                    kind: .textBlock,
                                    containerId: link.id,
                                    containerTitle: title,
                                    containerSubtitle: subtitle,
                                    blockId: blockId,
                                    snippet: m.snippet,
                                    snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                    timestamp: link.modifiedAt > 0 ? Date(timeIntervalSince1970: link.modifiedAt) : nil,
                                    score: score
                                )
                            )
                            containersWithTextBlock.insert(link.id)
                        }
                    }

                    // 仅标题/作者/URL/标签命中
                    for link in links where !containersWithTextBlock.contains(link.id) {
                        if Task.isCancelled { break }
                        let haystack = [
                            link.title ?? "",
                            link.author ?? "",
                            link.url,
                            link.tags ?? ""
                        ]
                        .joined(separator: "\n")

                        guard let m = SearchTextMatcher.match(text: haystack, query: query, snippetLimit: 140) else { continue }
                        let title = (link.title?.isEmpty == false ? link.title : nil) ?? link.url
                        let subtitle = (link.author?.isEmpty == false ? link.author : nil) ?? hostFromURL(link.url)
                        let score = 100_000 + (m.matchCount * 1000) - m.compactness

                        continuation.yield(
                            GlobalSearchResult(
                                source: .goodLinks,
                                kind: .titleOnly,
                                containerId: link.id,
                                containerTitle: title,
                                containerSubtitle: subtitle,
                                blockId: nil,
                                snippet: m.snippet,
                                snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                timestamp: link.modifiedAt > 0 ? Date(timeIntervalSince1970: link.modifiedAt) : nil,
                                score: score
                            )
                        )
                    }

                    continuation.finish()
                } catch {
                    logger.error("[GoodLinksSearch] failed: \(error.localizedDescription)")
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

    private func hostFromURL(_ urlString: String?) -> String? {
        guard let urlString, let url = URL(string: urlString) else { return nil }
        return url.host
    }
}

