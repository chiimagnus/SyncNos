import Foundation
import Combine

final class SyncQueueStore: SyncQueueStoreProtocol {
    private let notificationCenter: NotificationCenter
    private var cancellables = Set<AnyCancellable>()

    private let stateQueue = DispatchQueue(label: "sync.queue.store.state")
    private var tasksById: [String: SyncQueueTask] = [:]
    private var enqueuedOrder: [String] = []
    private var cleanupWorkItem: DispatchWorkItem?
    private let cleanupDelaySeconds: TimeInterval = 5 * 60

    private let subject = CurrentValueSubject<[SyncQueueTask], Never>([])

    init(notificationCenter: NotificationCenter = .default) {
        self.notificationCenter = notificationCenter

        // 入队事件
        notificationCenter.publisher(for: Notification.Name("SyncTasksEnqueued"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleEnqueue(info: info)
            }
            .store(in: &cancellables)

        // 运行状态事件（started/succeeded/failed）
        notificationCenter.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleStatusChanged(info: info)
            }
            .store(in: &cancellables)

        // 进度更新事件
        notificationCenter.publisher(for: Notification.Name("SyncProgressUpdated"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleProgress(info: info)
            }
            .store(in: &cancellables)
    }

    // MARK: - Public
    var snapshot: [SyncQueueTask] {
        stateQueue.sync { orderedTasks() }
    }

    var tasksPublisher: AnyPublisher<[SyncQueueTask], Never> {
        subject
            .receive(on: DispatchQueue.main)
            .eraseToAnyPublisher()
    }

    // MARK: - Private
    private func handleEnqueue(info: [String: Any]) {
        guard let sourceRaw = info["source"] as? String,
              let source = SyncSource(rawValue: sourceRaw),
              let items = info["items"] as? [[String: Any]] else { return }

        var changed = false
        stateQueue.sync {
            // 新任务入队 → 取消任何待执行的清理
            cancelScheduledCleanup_locked()
            for dict in items {
                guard let rawId = dict["id"] as? String,
                      let title = dict["title"] as? String else { continue }
                let subtitle = dict["subtitle"] as? String
                let temp = SyncQueueTask(rawId: rawId, source: source, title: title, subtitle: subtitle, state: .queued)
                if tasksById[temp.id] == nil {
                    tasksById[temp.id] = temp
                    enqueuedOrder.append(temp.id)
                    changed = true
                } // 已存在则忽略，等待延迟清理完成后再入队
            }
        }
        if changed { publish() }
    }

    private func handleStatusChanged(info: [String: Any]) {
        guard let rawId = info["bookId"] as? String,
              let status = info["status"] as? String else { return }

        var changed = false
        var matchedCount = 0
        stateQueue.sync {
            for key in enqueuedOrder {
                guard var t = tasksById[key], t.rawId == rawId else { continue }
                matchedCount += 1
                switch status {
                case "started": t.state = .running
                case "succeeded": t.state = .succeeded
                case "failed": t.state = .failed
                default: break
                }
                tasksById[key] = t
                changed = true
            }

            // 若没有任何排队或运行中的任务，说明本轮已结束 → 5 分钟后清理
            // 有活动任务则取消任何已计划的清理
            let hasActive = tasksById.values.contains { $0.state == .queued || $0.state == .running }
            if hasActive {
                cancelScheduledCleanup_locked()
            } else {
                scheduleDelayedCleanup_locked()
            }
        }
        
        // 调试日志：如果没有匹配到任何任务，记录警告
        if matchedCount == 0 {
            print("[SyncQueueStore] WARNING: No task matched for rawId=\(rawId), status=\(status)")
        }
        
        if changed { publish() }
    }

    private func handleProgress(info: [String: Any]) {
        guard let rawId = info["bookId"] as? String,
              let progress = info["progress"] as? String else { return }

        var changed = false
        stateQueue.sync {
            for key in enqueuedOrder {
                guard var t = tasksById[key], t.rawId == rawId else { continue }
                t.progressText = progress
                tasksById[key] = t
                changed = true
            }
        }
        if changed { publish() }
    }

    private func orderedTasks() -> [SyncQueueTask] {
        enqueuedOrder.compactMap { tasksById[$0] }
    }

    private func publish() {
        subject.send(stateQueue.sync { orderedTasks() })
    }

    // MARK: - Cleanup scheduling (must be called on stateQueue)
    private func cancelScheduledCleanup_locked() {
        cleanupWorkItem?.cancel()
        cleanupWorkItem = nil
    }

    private func scheduleDelayedCleanup_locked() {
        guard cleanupWorkItem == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            // 执行于 stateQueue 上
            if self.cleanupWorkItem?.isCancelled == true {
                self.cleanupWorkItem = nil
                return
            }
            let hasActive = self.tasksById.values.contains { $0.state == .queued || $0.state == .running }
            if !hasActive {
                self.tasksById.removeAll()
                self.enqueuedOrder.removeAll()
                self.cleanupWorkItem = nil
                self.publishLocked()
            } else {
                self.cleanupWorkItem = nil
            }
        }
        cleanupWorkItem = work
        stateQueue.asyncAfter(deadline: .now() + cleanupDelaySeconds, execute: work)
    }

    private func publishLocked() {
        // 已在 stateQueue 上，避免嵌套 sync
        subject.send(orderedTasks())
    }
}
