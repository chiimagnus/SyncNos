import Foundation
import Combine

final class SyncQueueStore: SyncQueueStoreProtocol {
    private let notificationCenter: NotificationCenter
    private var cancellables = Set<AnyCancellable>()

    private let stateQueue = DispatchQueue(label: "sync.queue.store.state")
    private var tasksById: [String: SyncQueueTask] = [:]
    private var enqueuedOrder: [String] = []
    private var cleanupWorkItem: DispatchWorkItem?
    private let cleanupDelaySeconds: TimeInterval = 10 * 60
    
    // MARK: - 失败任务冷却机制
    /// 失败任务的冷却时间（秒）
    private let failedTaskCooldownSeconds: TimeInterval = 60
    /// 记录任务失败时间：taskId -> failedAt
    private var failedTaskTimestamps: [String: Date] = [:]

    private let subject = CurrentValueSubject<[SyncQueueTask], Never>([])

    init(notificationCenter: NotificationCenter = .default) {
        self.notificationCenter = notificationCenter

        // 注意：入队现在通过 enqueue() 方法直接调用，不再监听 SyncTasksEnqueued 通知

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
    
    // MARK: - 入队 API（方案 2：单一真相源）
    
    /// 将任务入队，自动处理去重和冷却检查
    /// - Parameters:
    ///   - source: 数据源类型
    ///   - items: 待入队的任务列表
    /// - Returns: 实际被接受入队的任务 ID 集合
    @MainActor
    func enqueue(source: SyncSource, items: [SyncEnqueueItem]) -> Set<String> {
        var acceptedIds: Set<String> = []
        
        stateQueue.sync {
            cancelScheduledCleanup_locked()
            let now = Date()
            
            for item in items {
                let taskId = "\(source.rawValue):\(item.id)"
                
                // 检查冷却期
                if let failedAt = failedTaskTimestamps[taskId],
                   now.timeIntervalSince(failedAt) < failedTaskCooldownSeconds {
                    continue
                }
                
                // 检查是否已存在（去重）
                if tasksById[taskId] != nil {
                    continue
                }
                
                // 入队
                let task = SyncQueueTask(
                    rawId: item.id,
                    source: source,
                    title: item.title,
                    subtitle: item.subtitle,
                    state: .queued
                )
                tasksById[taskId] = task
                enqueuedOrder.append(taskId)
                acceptedIds.insert(item.id)
            }
        }
        
        if !acceptedIds.isEmpty {
            publish()
        }
        
        return acceptedIds
    }
    
    /// 检查任务是否正在处理（queued 或 running）
    func isTaskActive(source: SyncSource, rawId: String) -> Bool {
        let taskId = "\(source.rawValue):\(rawId)"
        return stateQueue.sync {
            guard let task = tasksById[taskId] else { return false }
            return task.state == .queued || task.state == .running
        }
    }
    
    /// 批量检查，返回正在处理的任务 ID
    func activeTaskIds(source: SyncSource, rawIds: Set<String>) -> Set<String> {
        stateQueue.sync {
            rawIds.filter { rawId in
                let taskId = "\(source.rawValue):\(rawId)"
                guard let task = tasksById[taskId] else { return false }
                return task.state == .queued || task.state == .running
            }
        }
    }
    
    // MARK: - 取消任务 API
    
    /// 取消单个等待中的任务
    /// - Parameters:
    ///   - source: 数据源类型
    ///   - rawId: 任务原始 ID
    /// - Returns: 是否成功取消
    @discardableResult
    func cancelTask(source: SyncSource, rawId: String) -> Bool {
        let taskId = "\(source.rawValue):\(rawId)"
        var cancelled = false
        
        stateQueue.sync {
            guard var task = tasksById[taskId] else { return }
            
            // 只能取消 queued 状态的任务
            // running 状态的任务需要通过 Task cancellation 机制
            if task.state == .queued {
                task.state = .cancelled
                tasksById[taskId] = task
                cancelled = true
            }
        }
        
        if cancelled {
            publish()
            // 发送取消通知，以便 SyncActivityMonitor 等组件感知
            notificationCenter.post(
                name: Notification.Name("SyncBookStatusChanged"),
                object: nil,
                userInfo: ["bookId": rawId, "status": "cancelled"]
            )
        }
        
        return cancelled
    }
    
    /// 取消所有等待中的任务（指定来源）
    /// - Parameter source: 数据源类型，nil 表示所有来源
    /// - Returns: 取消的任务数量
    @discardableResult
    func cancelAllQueued(source: SyncSource? = nil) -> Int {
        var cancelledCount = 0
        var cancelledRawIds: [String] = []
        
        stateQueue.sync {
            for key in enqueuedOrder {
                guard var task = tasksById[key] else { continue }
                
                // 过滤来源
                if let source, task.source != source { continue }
                
                // 只取消 queued 状态的任务
                if task.state == .queued {
                    task.state = .cancelled
                    tasksById[key] = task
                    cancelledCount += 1
                    cancelledRawIds.append(task.rawId)
                }
            }
        }
        
        if cancelledCount > 0 {
            publish()
            // 批量发送取消通知
            for rawId in cancelledRawIds {
                notificationCenter.post(
                    name: Notification.Name("SyncBookStatusChanged"),
                    object: nil,
                    userInfo: ["bookId": rawId, "status": "cancelled"]
                )
            }
        }
        
        return cancelledCount
    }
    
    /// 清除所有已完成的任务（succeeded/failed/cancelled）
    func clearCompleted() {
        stateQueue.sync {
            let toRemove = enqueuedOrder.filter { key in
                guard let task = tasksById[key] else { return true }
                return task.state == .succeeded || task.state == .failed || task.state == .cancelled
            }
            for key in toRemove {
                tasksById.removeValue(forKey: key)
                failedTaskTimestamps.removeValue(forKey: key)
            }
            enqueuedOrder.removeAll { toRemove.contains($0) }
        }
        publish()
    }

    // MARK: - Private (通知处理)
    
    private func handleStatusChanged(info: [String: Any]) {
        guard let rawId = info["bookId"] as? String,
              let status = info["status"] as? String else { return }
        
        // 提取错误信息（如果有）
        let errorInfo = info["errorInfo"] as? SyncErrorInfo

        var changed = false
        var matchedCount = 0
        stateQueue.sync {
            let now = Date()
            
            for key in enqueuedOrder {
                guard var t = tasksById[key], t.rawId == rawId else { continue }
                matchedCount += 1
                switch status {
                case "started":
                    t.state = .running
                    // 清除之前可能残留的错误信息
                    t.errorType = nil
                    t.errorMessage = nil
                    t.errorDetails = nil
                case "succeeded":
                    t.state = .succeeded
                    // 成功时清除冷却记录（如果有）
                    failedTaskTimestamps.removeValue(forKey: key)
                    // 清除错误信息
                    t.errorType = nil
                    t.errorMessage = nil
                    t.errorDetails = nil
                case "failed":
                    t.state = .failed
                    // 记录失败时间，启动冷却机制
                    failedTaskTimestamps[key] = now
                    // 记录错误信息
                    if let errorInfo {
                        t.errorType = errorInfo.type
                        t.errorMessage = errorInfo.message
                        t.errorDetails = errorInfo.details
                    }
                case "cancelled":
                    t.state = .cancelled
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
                // 清理冷却记录（冷却时间已远超 cleanupDelaySeconds）
                self.failedTaskTimestamps.removeAll()
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
