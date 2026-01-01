import Foundation
import Combine

@MainActor
final class MenuBarViewModel: ObservableObject {
    // MARK: - Published UI States
    @Published private(set) var runningCount: Int = 0
    @Published private(set) var queuedCount: Int = 0
    @Published private(set) var failedCount: Int = 0
    @Published private(set) var isAutoSyncRunning: Bool = false
    @Published private(set) var nextSyncTime: Date?

    // MARK: - Dependencies
    private let autoSyncService: AutoSyncServiceProtocol
    private let queueStore: SyncQueueStoreProtocol
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init
    init(
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService,
        queueStore: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore
    ) {
        self.autoSyncService = autoSyncService
        self.queueStore = queueStore
        self.isAutoSyncRunning = autoSyncService.isRunning
        self.nextSyncTime = autoSyncService.nextSyncTime

        // 订阅队列变更以汇总数量
        queueStore.tasksPublisher
            .map { tasks -> (Int, Int, Int) in
                let running = tasks.filter { $0.state == .running }.count
                let queued = tasks.filter { $0.state == .queued }.count
                let failed = tasks.filter { $0.state == .failed }.count
                return (running, queued, failed)
            }
            .sink { [weak self] running, queued, failed in
                self?.runningCount = running
                self?.queuedCount = queued
                self?.failedCount = failed
            }
            .store(in: &cancellables)
        
        // 订阅下次同步时间变更
        autoSyncService.nextSyncTimePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] time in
                self?.nextSyncTime = time
                self?.isAutoSyncRunning = self?.autoSyncService.isRunning ?? false
            }
            .store(in: &cancellables)
    }

    // MARK: - Computed Properties
    
    /// Formatted string for next sync time display
    var nextSyncTimeFormatted: String? {
        guard let time = nextSyncTime else { return nil }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: time)
    }
}
