import Foundation
import Combine

@MainActor
final class SyncQueueViewModel: ObservableObject {
    @Published var runningTasks: [SyncQueueTask] = []
    @Published var queuedTasks: [SyncQueueTask] = []
    @Published var failedTasks: [SyncQueueTask] = []

    var concurrencyLimit: Int { NotionSyncConfig.batchConcurrency }

    private let store: SyncQueueStoreProtocol
    private var cancellables: Set<AnyCancellable> = []

    init(store: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore) {
        self.store = store

        // 保留 SyncQueueStore 的入队顺序：直接在已排序的 tasks 流上筛选状态
        store.tasksPublisher
            .map { tasks -> ([SyncQueueTask], [SyncQueueTask], [SyncQueueTask]) in
                let running = tasks.filter { $0.state == .running }
                let queued = tasks.filter { $0.state == .queued }
                let failed = tasks.filter { $0.state == .failed }
                return (running, queued, failed)
            }
            .sink { [weak self] running, queued, failed in
                self?.runningTasks = running
                self?.queuedTasks = queued
                self?.failedTasks = failed
            }
            .store(in: &cancellables)
    }
}
