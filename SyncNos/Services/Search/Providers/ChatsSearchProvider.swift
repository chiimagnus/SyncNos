import Foundation

// MARK: - Chats Search Provider

final class ChatsSearchProvider: GlobalSearchProvider {
    let source: ContentSource = .chats

    private let cacheService: ChatCacheServiceProtocol
    private let logger: LoggerServiceProtocol

    init(cacheService: ChatCacheServiceProtocol, logger: LoggerServiceProtocol) {
        self.cacheService = cacheService
        self.logger = logger
    }

    func search(query: String, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let conversations = try await cacheService.fetchAllConversations()
                    var containersWithTextBlock = Set<String>()

                    var yielded = 0
                    for conv in conversations {
                        if Task.isCancelled { break }
                        if yielded >= limit { break }

                        // 倒序分页扫描：从最新消息开始
                        let pageSize = 60
                        let maxPages = 8
                        var offset = 0
                        var anyHit = false

                        for _ in 0..<maxPages {
                            if Task.isCancelled { break }
                            if yielded >= limit { break }

                            let page = try await cacheService.fetchMessagesPage(
                                conversationId: conv.contactId.uuidString,
                                limit: pageSize,
                                offset: offset
                            )
                            if page.isEmpty { break }

                            for msg in page {
                                if Task.isCancelled { break }
                                if yielded >= limit { break }

                                guard let m = SearchTextMatcher.match(text: msg.content, query: query, snippetLimit: 160) else { continue }
                                let score = 1_000_000 + (m.matchCount * 1000) - m.compactness
                                continuation.yield(
                                    GlobalSearchResult(
                                        source: .chats,
                                        kind: .textBlock,
                                        containerId: conv.contactId.uuidString,
                                        containerTitle: conv.name.isEmpty ? "未命名对话" : conv.name,
                                        containerSubtitle: msg.senderName,
                                        blockId: msg.id.uuidString,
                                        snippet: m.snippet,
                                        snippetMatchRangesUTF16: m.snippetMatchRangesUTF16,
                                        timestamp: nil,
                                        score: score
                                    )
                                )
                                yielded += 1
                                anyHit = true
                                containersWithTextBlock.insert(conv.contactId.uuidString)
                            }

                            offset += pageSize
                        }

                        if anyHit { continue }
                    }

                    // 仅对话名命中
                    for conv in conversations where !containersWithTextBlock.contains(conv.contactId.uuidString) {
                        if Task.isCancelled { break }
                        guard let m = SearchTextMatcher.match(text: conv.name, query: query, snippetLimit: 120) else { continue }
                        let score = 100_000 + (m.matchCount * 1000) - m.compactness
                        continuation.yield(
                            GlobalSearchResult(
                                source: .chats,
                                kind: .titleOnly,
                                containerId: conv.contactId.uuidString,
                                containerTitle: conv.name.isEmpty ? "未命名对话" : conv.name,
                                containerSubtitle: nil,
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
                    logger.error("[ChatsSearch] failed: \(error.localizedDescription)")
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}
