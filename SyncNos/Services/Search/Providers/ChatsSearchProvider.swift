import Foundation

// MARK: - Chats Search Provider

final class ChatsSearchProvider: GlobalSearchProvider {
    private actor ScanState {
        private let limit: Int
        private var yielded: Int = 0
        private var containersWithTextBlock: Set<String> = []

        init(limit: Int) {
            self.limit = max(0, limit)
        }

        var isLimitReached: Bool {
            yielded >= limit
        }

        func tryConsumeYield(containerId: String? = nil) -> Bool {
            guard yielded < limit else { return false }
            yielded += 1
            if let containerId {
                containersWithTextBlock.insert(containerId)
            }
            return true
        }

        func getContainersWithTextBlock() -> Set<String> {
            containersWithTextBlock
        }
    }

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
                    let state = ScanState(limit: limit)
                    let maxConcurrent = 4

                    var iterator = conversations.makeIterator()
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        for _ in 0..<maxConcurrent {
                            guard let conv = iterator.next() else { break }
                            group.addTask {
                                try await self.scanConversation(
                                    conv,
                                    query: query,
                                    state: state,
                                    continuation: continuation
                                )
                            }
                        }

                        while let _ = try await group.next() {
                            if Task.isCancelled {
                                group.cancelAll()
                                break
                            }
                            if await state.isLimitReached {
                                group.cancelAll()
                                break
                            }
                            guard let conv = iterator.next() else { break }
                            group.addTask {
                                try await self.scanConversation(
                                    conv,
                                    query: query,
                                    state: state,
                                    continuation: continuation
                                )
                            }
                        }
                    }

                    // 仅对话名命中
                    let containersWithTextBlock = await state.getContainersWithTextBlock()
                    for conv in conversations where !containersWithTextBlock.contains(conv.contactId.uuidString) {
                        if Task.isCancelled { break }
                        if await state.isLimitReached { break }
                        guard let m = SearchTextMatcher.match(text: conv.name, query: query, snippetLimit: 120) else { continue }
                        if await state.tryConsumeYield() == false { break }
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
                } catch is CancellationError {
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

    private func scanConversation(
        _ conv: ChatBookListItem,
        query: String,
        state: ScanState,
        continuation: AsyncThrowingStream<GlobalSearchResult, Error>.Continuation
    ) async throws {
        if Task.isCancelled { return }
        if await state.isLimitReached { return }

        // 倒序分页扫描：从最新消息开始
        let pageSize = 60
        let maxPages = 8
        var offset = 0

        for _ in 0..<maxPages {
            if Task.isCancelled { break }
            if await state.isLimitReached { break }

            let page = try await cacheService.fetchMessagesPage(
                conversationId: conv.contactId.uuidString,
                limit: pageSize,
                offset: offset
            )
            if page.isEmpty { break }

            for msg in page {
                if Task.isCancelled { break }
                if await state.isLimitReached { break }

                guard let m = SearchTextMatcher.match(text: msg.content, query: query, snippetLimit: 160) else { continue }
                if await state.tryConsumeYield(containerId: conv.contactId.uuidString) == false { break }

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
            }

            offset += pageSize
        }
    }
}
