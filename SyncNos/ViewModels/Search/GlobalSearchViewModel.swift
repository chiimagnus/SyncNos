import Foundation
import Combine

// MARK: - Global Search ViewModel

@MainActor
final class GlobalSearchViewModel: ObservableObject {
    private struct ResultEntry: Sendable {
        var result: GlobalSearchResult
        let firstSeenOrder: Int
    }

    // MARK: - Published

    @Published var query: String = ""
    @Published var scope: GlobalSearchScope = .allEnabled
    @Published private(set) var results: [GlobalSearchResult] = []
    @Published private(set) var isSearching: Bool = false
    @Published private(set) var errorMessage: String?

    @Published var selectedResultId: String?

    // MARK: - Dependencies

    private let engine: GlobalSearchEngineProtocol
    private let logger: LoggerServiceProtocol

    // MARK: - State

    private var enabledSources: [ContentSource] = []
    private var debounceTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var resultEntries: [String: ResultEntry] = [:]
    private var nextResultOrder: Int = 0
    /// 用户是否主动移动过选中项；若是则不再在刷新排序时自动改写 selection（避免“跳来跳去”）
    private var hasUserInteractedWithSelection: Bool = false

    init(
        engine: GlobalSearchEngineProtocol = DIContainer.shared.globalSearchEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.engine = engine
        self.logger = logger
    }

    func updateEnabledSources(_ sources: [ContentSource]) {
        enabledSources = sources
    }

    func scheduleSearch() {
        debounceTask?.cancel()
        debounceTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: 280_000_000) // 280ms
            if Task.isCancelled { return }
            await self.runSearch()
        }
    }

    func markUserSelectionInteraction() {
        hasUserInteractedWithSelection = true
    }

    func clear() {
        query = ""
        scope = .allEnabled
        selectedResultId = nil
        results.removeAll(keepingCapacity: false)
        resultEntries.removeAll(keepingCapacity: false)
        nextResultOrder = 0
        errorMessage = nil
        isSearching = false
        hasUserInteractedWithSelection = false
        debounceTask?.cancel()
        searchTask?.cancel()
        refreshTask?.cancel()
        debounceTask = nil
        searchTask = nil
        refreshTask = nil
    }

    // MARK: - Search

    private func runSearch() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            resultEntries = [:]
            nextResultOrder = 0
            selectedResultId = nil
            errorMessage = nil
            isSearching = false
            hasUserInteractedWithSelection = false
            return
        }

        searchTask?.cancel()
        refreshTask?.cancel()
        resultEntries.removeAll(keepingCapacity: true)
        nextResultOrder = 0
        results.removeAll(keepingCapacity: true)
        selectedResultId = nil
        errorMessage = nil
        isSearching = true
        hasUserInteractedWithSelection = false

        let currentScope = scope
        let sources = enabledSources
        let engine = engine
        let logger = logger

        let task = Task { [weak self] in
            guard let self else { return }
            do {
                for try await r in engine.search(query: trimmed, scope: currentScope, enabledSources: sources, limit: 500) {
                    if Task.isCancelled { break }
                    await self.receiveIncomingResult(r)
                }
                await MainActor.run {
                    self.isSearching = false
                }
            } catch {
                logger.error("[GlobalSearch] failed: \(error.localizedDescription)")
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isSearching = false
                }
            }
        }
        searchTask = task
    }

    private func receiveIncomingResult(_ r: GlobalSearchResult) {
        upsertResult(r)

        // 仅在“尚未排序刷新”前给一个兜底 selection（后续以 applySortedResults 的排序为准）
        if !hasUserInteractedWithSelection, selectedResultId == nil {
            selectedResultId = r.id
        }
    }

    private func upsertResult(_ r: GlobalSearchResult) {
        if var existing = resultEntries[r.id] {
            // 保留更高分的结果（同 id 可能来自不同字段）
            if r.score > existing.result.score {
                existing.result = r
                resultEntries[r.id] = existing
            }
        } else {
            resultEntries[r.id] = ResultEntry(result: r, firstSeenOrder: nextResultOrder)
            nextResultOrder += 1
        }
        scheduleRefresh()
    }

    private func scheduleRefresh() {
        guard refreshTask == nil else { return }
        refreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.refreshTask = nil }
            try? await Task.sleep(nanoseconds: 16_000_000) // 16ms
            if Task.isCancelled { return }
            self.applySortedResults()
        }
    }

    private func applySortedResults() {
        let sortedEntries = resultEntries.values.sorted { ea, eb in
            let a = ea.result
            let b = eb.result
            if a.score != b.score { return a.score > b.score }
            switch (a.timestamp, b.timestamp) {
            case let (ta?, tb?):
                if ta != tb { return ta > tb }
            case (nil, .some):
                return false
            case (.some, nil):
                return true
            case (nil, nil):
                break
            }
            if a.source != b.source { return a.source.rawValue < b.source.rawValue }
            if a.containerTitle != b.containerTitle { return a.containerTitle < b.containerTitle }
            if ea.firstSeenOrder != eb.firstSeenOrder { return ea.firstSeenOrder < eb.firstSeenOrder }
            return a.id < b.id
        }
        let sorted = sortedEntries.map(\.result)
        results = sorted

        // 若用户未交互：让 selection 跟随“当前排序第一项”，避免首次 selection 落在中间某个结果
        if !hasUserInteractedWithSelection {
            selectedResultId = sorted.first?.id
            return
        }

        // 若用户已交互：保持原选中；但如果原 id 消失则兜底到第一项
        if let id = selectedResultId, !sorted.contains(where: { $0.id == id }) {
            selectedResultId = sorted.first?.id
        }
    }
}
