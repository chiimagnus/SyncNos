import Foundation
import Combine

final class LogViewModel: ObservableObject {
    @Published private(set) var entries: [LogEntry] = []
    @Published var levelFilter: LogLevel = .verbose

    private var cancellables = Set<AnyCancellable>()
    private let logger: LoggerServiceProtocol

    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger

        // 初始加载已有日志
        self.entries = logger.getAllLogs()

        // 订阅新日志
        let pub: AnyPublisher<LogEntry, Never> = logger.logPublisher
        pub
            .receive(on: DispatchQueue.main)
            .sink { [weak self] entry in
                guard let self = self else { return }
                if entry.level.rawValue >= self.levelFilter.rawValue {
                    self.entries.append(entry)
                }
            }
            .store(in: &cancellables)

        // 监听过滤器变化，将会重新过滤现有日志
        $levelFilter
            .receive(on: DispatchQueue.main)
            .sink { [weak self] level in
                guard let self = self else { return }
                self.entries = self.logger.getAllLogs().filter { $0.level.rawValue >= level.rawValue }
            }
            .store(in: &cancellables)
    }

    func clear() {
        logger.clearLogs()
        entries.removeAll()
    }

    func export(to url: URL) throws {
        try logger.exportLogs(to: url)
    }
}


