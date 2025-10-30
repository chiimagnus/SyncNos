import Foundation
import Combine

@MainActor
final class SyncQueueViewModel: ObservableObject {
    @Published var runningAppleBooks: [SyncQueueTask] = []
    @Published var runningGoodLinks: [SyncQueueTask] = []
    @Published var queuedAppleBooks: [SyncQueueTask] = []
    @Published var queuedGoodLinks: [SyncQueueTask] = []

    var concurrencyLimit: Int { NotionSyncConfig.batchConcurrency }

    private let store: SyncQueueStoreProtocol
    private var cancellables: Set<AnyCancellable> = []

    init(store: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore) {
        self.store = store

        store.tasksPublisher
            .map { tasks -> ([SyncQueueTask], [SyncQueueTask], [SyncQueueTask], [SyncQueueTask]) in
                let running = tasks.filter { $0.state == .running }
                let queued = tasks.filter { $0.state == .queued }
                let runningAB = running.filter { $0.source == .appleBooks }
                let runningGL = running.filter { $0.source == .goodLinks }
                let queuedAB = queued.filter { $0.source == .appleBooks }
                let queuedGL = queued.filter { $0.source == .goodLinks }
                return (runningAB, runningGL, queuedAB, queuedGL)
            }
            .sink { [weak self] runningAB, runningGL, queuedAB, queuedGL in
                self?.runningAppleBooks = runningAB
                self?.runningGoodLinks = runningGL
                self?.queuedAppleBooks = queuedAB
                self?.queuedGoodLinks = queuedGL
            }
            .store(in: &cancellables)
    }
}


