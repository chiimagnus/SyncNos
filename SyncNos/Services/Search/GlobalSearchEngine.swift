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
    private enum Defaults {
        static let perProviderLimit: Int = 200
    }

    private actor ResultGate {
        enum Decision {
            case yield
            case skip
            /// 已达到“唯一结果数上限”，且当前是全新 key；建议直接停止继续扫描
            case stop
        }

        private let maxUniqueCount: Int
        private var bestScoreByKey: [String: Int] = [:]

        init(maxUniqueCount: Int) {
            self.maxUniqueCount = max(0, maxUniqueCount)
        }

        func decide(_ r: GlobalSearchResult) -> Decision {
            if let existing = bestScoreByKey[r.id] {
                if r.score > existing {
                    bestScoreByKey[r.id] = r.score
                    return .yield
                }
                return .skip
            }

            if bestScoreByKey.count >= maxUniqueCount {
                return .stop
            }

            bestScoreByKey[r.id] = r.score
            return .yield
        }
    }

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
        let totalLimit = max(0, limit)
        guard !trimmed.isEmpty, totalLimit > 0 else {
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

        let perProviderLimit = min(Defaults.perProviderLimit, totalLimit)

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let gate = ResultGate(maxUniqueCount: totalLimit)
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        for source in sourcesToSearch {
                            guard let provider = providers[source] else { continue }
                            group.addTask {
                                providerLoop: for try await r in provider.search(query: trimmed, limit: perProviderLimit) {
                                    if Task.isCancelled { break }
                                    switch await gate.decide(r) {
                                    case .yield:
                                        continuation.yield(r)
                                    case .skip:
                                        continue
                                    case .stop:
                                        break providerLoop
                                    }
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
