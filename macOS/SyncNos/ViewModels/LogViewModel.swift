import Foundation
import Combine

final class LogViewModel: ObservableObject {
    @Published private(set) var entries: [LogEntry] = []
    @Published var levelFilter: LogLevel = .info
    @Published var searchText: String = ""

    private var cancellables = Set<AnyCancellable>()
    private let logger: LoggerServiceProtocol
    private var allEntries: [LogEntry] = []

    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger

        // 初始加载已有日志
        self.allEntries = logger.getAllLogs()
        self.entries = filterEntries(allEntries)

        // 订阅新日志
        let pub: AnyPublisher<LogEntry, Never> = logger.logPublisher
        pub
            .receive(on: DispatchQueue.main)
            .sink { [weak self] entry in
                guard let self = self else { return }
                self.allEntries.append(entry)
                // 只有符合过滤条件的才添加到显示列表
                if self.shouldInclude(entry) {
                    self.entries.append(entry)
                }
            }
            .store(in: &cancellables)

        // 监听过滤器变化和搜索文本变化
        Publishers.CombineLatest($levelFilter, $searchText)
            .debounce(for: .milliseconds(150), scheduler: DispatchQueue.main)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _, _ in
                guard let self = self else { return }
                self.entries = self.filterEntries(self.allEntries)
            }
            .store(in: &cancellables)
    }
    
    private func filterEntries(_ entries: [LogEntry]) -> [LogEntry] {
        entries.filter { shouldInclude($0) }
    }
    
    private func shouldInclude(_ entry: LogEntry) -> Bool {
        // 级别过滤
        guard entry.level.rawValue >= levelFilter.rawValue else { return false }
        
        // 搜索过滤
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        
        // 在消息、文件名、函数名中搜索（不区分大小写）
        let lowercased = trimmed.lowercased()
        return entry.message.lowercased().contains(lowercased)
            || entry.file.lowercased().contains(lowercased)
            || entry.function.lowercased().contains(lowercased)
    }

    func clear() {
        logger.clearLogs()
        allEntries.removeAll()
        entries.removeAll()
    }

    func export(to url: URL) throws {
        try logger.exportLogs(to: url)
    }

    /// Export currently filtered entries (entries array) to file.
    func exportFiltered(to url: URL) throws {
        var lines: [String] = []
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        for e in entries {
            let time = formatter.string(from: e.timestamp)
            let line = "\(time) [\(e.level.description)] \(e.file):\(e.line) \(e.function) - \(e.message)"
            lines.append(line)
        }
        let content = lines.joined(separator: "\n")
        try content.write(to: url, atomically: true, encoding: .utf8)
    }
}
