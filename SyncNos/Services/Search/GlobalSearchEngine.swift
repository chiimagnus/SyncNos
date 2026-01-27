import Foundation

// MARK: - Global Search Engine

protocol GlobalSearchEngineProtocol: Sendable {
    func search(
        query: String,
        scope: GlobalSearchScope,
        enabledSources: [ContentSource],
        limit: Int
    ) -> AsyncThrowingStream<GlobalSearchResult, Error>
}

/// 聚合多个 Provider 的搜索引擎（负责并发、取消、合并输出）
final class GlobalSearchEngine: GlobalSearchEngineProtocol {
    private let providers: [ContentSource: any GlobalSearchProvider]

    init(providers: [ContentSource: any GlobalSearchProvider]) {
        self.providers = providers
    }

    func search(
        query: String,
        scope: GlobalSearchScope,
        enabledSources: [ContentSource],
        limit: Int
    ) -> AsyncThrowingStream<GlobalSearchResult, Error> {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return AsyncThrowingStream { $0.finish() }
        }

        let sourcesToSearch: [ContentSource] = {
            switch scope {
            case .allEnabled:
                return enabledSources
            case .source(let s):
                return enabledSources.contains(s) ? [s] : []
            }
        }()

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        for source in sourcesToSearch {
                            guard let provider = providers[source] else { continue }
                            group.addTask {
                                for try await r in provider.search(query: trimmed, limit: limit) {
                                    if Task.isCancelled { break }
                                    continuation.yield(r)
                                }
                            }
                        }
                        try await group.waitForAll()
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

