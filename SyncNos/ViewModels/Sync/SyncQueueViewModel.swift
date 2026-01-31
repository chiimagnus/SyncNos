import Foundation
import Combine

@MainActor
final class SyncQueueViewModel: ObservableObject {
    @Published var runningTasks: [SyncQueueTask] = []
    @Published var queuedTasks: [SyncQueueTask] = []
    @Published var failedTasks: [SyncQueueTask] = []
    @Published var cancelledTasks: [SyncQueueTask] = []

    /// 等待队列任务总数（包含未在 UI 中展示的部分）
    @Published var queuedTotalCount: Int = 0
    /// 失败任务总数（包含未在 UI 中展示的部分）
    @Published var failedTotalCount: Int = 0
    /// 已取消任务总数
    @Published var cancelledTotalCount: Int = 0

    // MARK: - UI Display Limits

    /// 等待队列在 UI 中最多展示的任务数量（动态递增）
    @Published private(set) var queuedDisplayLimit: Int = 50
    /// 失败队列在 UI 中最多展示的任务数量（nil 表示显示全部）
    @Published private(set) var failedDisplayLimit: Int? = 50

    var concurrencyLimit: Int { NotionSyncConfig.batchConcurrency }
    
    /// 是否有等待中的任务可以取消
    var hasQueuedTasks: Bool { queuedTotalCount > 0 }
    
    /// 是否有已完成的任务可以清除
    var hasCompletedTasks: Bool { failedTotalCount > 0 || cancelledTotalCount > 0 }

    private let store: SyncQueueStoreProtocol
    private var cancellables: Set<AnyCancellable> = []
    private let queuedLimitSubject = CurrentValueSubject<Int, Never>(50)
    private let failedLimitSubject = CurrentValueSubject<Int?, Never>(50)
    private let queuedPageSize: Int = 50
    private let queuedPrefetchThreshold: Int = 6

    /// 内部使用的小型任务分组结构，便于 `removeDuplicates` 直接基于 `Equatable` 比较
    private struct TaskGroups: Equatable {
        var running: [SyncQueueTask]
        var queued: [SyncQueueTask]
        var failed: [SyncQueueTask]
        var cancelled: [SyncQueueTask]
        var queuedTotal: Int
        var failedTotal: Int
        var cancelledTotal: Int
    }

    private func groupTasks(_ tasks: [SyncQueueTask], queuedLimit: Int, failedLimit: Int?) -> TaskGroups {
        // 运行中的任务数量由全局并发限制器控制，保持全部展示即可
        let running = tasks.filter { $0.state == .running }
        let queuedAll = tasks.filter { $0.state == .queued }
        let failedAll = tasks.filter { $0.state == .failed }
        let cancelledAll = tasks.filter { $0.state == .cancelled }

        let queued = Array(queuedAll.prefix(queuedLimit))

        let failed: [SyncQueueTask]
        if let failedLimit {
            failed = Array(failedAll.prefix(failedLimit))
        } else {
            failed = failedAll
        }

        let cancelled = cancelledAll
        return TaskGroups(
            running: running,
            queued: queued,
            failed: failed,
            cancelled: cancelled,
            queuedTotal: queuedAll.count,
            failedTotal: failedAll.count,
            cancelledTotal: cancelledAll.count
        )
    }

    init(store: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore) {
        self.store = store

        // 保留 SyncQueueStore 的入队顺序：直接在已排序的 tasks 流上筛选状态
        store.tasksPublisher
            // 将底层频繁的进度更新合并到每 120ms 一次的 UI 更新中，避免主线程高频重绘
            .throttle(for: .milliseconds(120), scheduler: DispatchQueue.main, latest: true)
            .combineLatest(queuedLimitSubject, failedLimitSubject)
            .map { [weak self] tasks, queuedLimit, failedLimit -> TaskGroups in
                guard let self else {
                    return TaskGroups(running: [], queued: [], failed: [], cancelled: [], queuedTotal: 0, failedTotal: 0, cancelledTotal: 0)
                }
                return self.groupTasks(tasks, queuedLimit: queuedLimit, failedLimit: failedLimit)
            }
            // 若三组任务内容完全一致，则跳过 UI 更新
            .removeDuplicates()
            .sink { [weak self] groups in
                self?.runningTasks = groups.running
                self?.queuedTasks = groups.queued
                self?.failedTasks = groups.failed
                self?.cancelledTasks = groups.cancelled
                self?.queuedTotalCount = groups.queuedTotal
                self?.failedTotalCount = groups.failedTotal
                self?.cancelledTotalCount = groups.cancelledTotal
            }
            .store(in: &cancellables)
    }

    // MARK: - Display Limit Controls

    func loadMoreQueuedIfNeeded(currentTask: SyncQueueTask) {
        guard queuedTasks.count < queuedTotalCount else { return }
        guard let currentIndex = queuedTasks.firstIndex(where: { $0.id == currentTask.id }) else { return }
        let thresholdIndex = max(queuedTasks.count - queuedPrefetchThreshold, 0)
        guard currentIndex >= thresholdIndex else { return }
        increaseQueuedLimit()
    }

    private func increaseQueuedLimit() {
        let nextLimit = min(queuedDisplayLimit + queuedPageSize, queuedTotalCount)
        guard nextLimit > queuedDisplayLimit else { return }
        queuedDisplayLimit = nextLimit
        queuedLimitSubject.send(nextLimit)
    }

    func showAllFailed() {
        failedDisplayLimit = nil
        failedLimitSubject.send(nil)
    }

    func showFailed(limit: Int) {
        failedDisplayLimit = limit
        failedLimitSubject.send(limit)
    }
    
    // MARK: - 取消操作
    
    /// 取消单个等待中的任务
    func cancelTask(_ task: SyncQueueTask) {
        store.cancelTask(source: task.source, rawId: task.rawId)
        Task {
            _ = await DIContainer.shared.syncRunningTaskStore.cancel(taskId: task.id)
        }
    }
    
    /// 取消所有等待中的任务
    func cancelAllQueued() {
        let queuedTaskIds = store.snapshot
            .filter { $0.state == .queued }
            .map(\.id)
        store.cancelAllQueued(source: nil)
        Task {
            _ = await DIContainer.shared.syncRunningTaskStore.cancelAll(taskIds: queuedTaskIds)
        }
    }
    
    /// 取消指定来源的所有等待任务
    func cancelAllQueued(source: ContentSource) {
        let queuedTaskIds = store.snapshot
            .filter { $0.state == .queued && $0.source == source }
            .map(\.id)
        store.cancelAllQueued(source: source)
        Task {
            _ = await DIContainer.shared.syncRunningTaskStore.cancelAll(taskIds: queuedTaskIds)
        }
    }
    
    /// 取消正在运行的任务（best-effort，依赖 Task cancellation）
    func cancelRunningTask(_ task: SyncQueueTask) {
        NotificationCenter.default.post(
            name: .syncProgressUpdated,
            object: nil,
            userInfo: ["bookId": task.rawId, "source": task.source.rawValue, "progress": NSLocalizedString("Cancelling...", comment: "")]
        )
        Task {
            _ = await DIContainer.shared.syncRunningTaskStore.cancel(taskId: task.id)
        }
    }
    
    /// 清除所有已完成的任务（succeeded/failed/cancelled）
    func clearCompleted() {
        store.clearCompleted()
    }
}
