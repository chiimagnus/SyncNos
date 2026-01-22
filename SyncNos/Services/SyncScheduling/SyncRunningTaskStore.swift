import Foundation

// MARK: - SyncRunningTaskStore

/// 记录正在执行/等待并发许可的同步 Task，用于从 UI 发起取消（running/queued）。
/// Key 使用 `SyncQueueTask.id`（形如 `goodLinks:123`），与 SyncQueueStore 保持一致。
actor SyncRunningTaskStore {
    private var tasksById: [String: Task<Void, Never>] = [:]

    func register(taskId: String, task: Task<Void, Never>) {
        tasksById[taskId] = task
    }

    func unregister(taskId: String) {
        tasksById.removeValue(forKey: taskId)
    }

    @discardableResult
    func cancel(taskId: String) -> Bool {
        guard let task = tasksById[taskId] else { return false }
        task.cancel()
        return true
    }

    @discardableResult
    func cancelAll(taskIds: [String]) -> Int {
        var cancelled = 0
        for id in taskIds {
            if cancel(taskId: id) { cancelled += 1 }
        }
        return cancelled
    }
}

