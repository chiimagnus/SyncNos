import Foundation

// MARK: - Global Search Provider

/// 每个数据源实现一个 Provider，用于产出全局搜索结果（流式输出）
protocol GlobalSearchProvider: Sendable {
    var source: ContentSource { get }
    func search(query: String, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error>
}

