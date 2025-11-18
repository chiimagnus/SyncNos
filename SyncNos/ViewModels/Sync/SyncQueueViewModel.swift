import Foundation
import Combine

@MainActor
final class SyncQueueViewModel: ObservableObject {
    @Published var runningTasks: [SyncQueueTask] = []
    @Published var queuedTasks: [SyncQueueTask] = []
    @Published var failedTasks: [SyncQueueTask] = []

    /// 等待队列在 UI 中最多展示的任务数量（完整数据仍保存在 `SyncQueueStore` 中）
    private let maxQueuedDisplayCount: Int = 5
    /// 失败队列在 UI 中最多展示的任务数量
    private let maxFailedDisplayCount: Int = 5

    var concurrencyLimit: Int { NotionSyncConfig.batchConcurrency }

    private let store: SyncQueueStoreProtocol
    private var cancellables: Set<AnyCancellable> = []

    /// 内部使用的小型任务分组结构，便于 `removeDuplicates` 直接基于 `Equatable` 比较
    private struct TaskGroups: Equatable {
        var running: [SyncQueueTask]
        var queued: [SyncQueueTask]
        var failed: [SyncQueueTask]
    }

    private func groupTasks(_ tasks: [SyncQueueTask]) -> TaskGroups {
        // 运行中的任务数量由全局并发限制器控制，保持全部展示即可
        let running = tasks.filter { $0.state == .running }
        // 等待与失败任务只截取前 N 项，避免 ForEach 渲染上千条导致卡顿
        let queuedAll = tasks.filter { $0.state == .queued }
        let failedAll = tasks.filter { $0.state == .failed }
        let queued = Array(queuedAll.prefix(maxQueuedDisplayCount))
        let failed = Array(failedAll.prefix(maxFailedDisplayCount))
        return TaskGroups(running: running, queued: queued, failed: failed)
    }

    init(store: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore) {
        self.store = store

        // 保留 SyncQueueStore 的入队顺序：直接在已排序的 tasks 流上筛选状态
        store.tasksPublisher
            // 将底层频繁的进度更新合并到每 120ms 一次的 UI 更新中，避免主线程高频重绘
            .throttle(for: .milliseconds(120), scheduler: DispatchQueue.main, latest: true)
            .map { [weak self] tasks -> TaskGroups in
                guard let self else {
                    return TaskGroups(running: [], queued: [], failed: [])
                }
                return self.groupTasks(tasks)
            }
            // 若三组任务内容完全一致，则跳过 UI 更新
            .removeDuplicates()
            .sink { [weak self] groups in
                self?.runningTasks = groups.running
                self?.queuedTasks = groups.queued
                self?.failedTasks = groups.failed
            }
            .store(in: &cancellables)
    }
}
