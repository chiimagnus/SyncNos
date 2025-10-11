import Foundation

/// Actor-based 并发限流器，用于限制同时对 Notion API 发起的请求数量
/// 使用信号量机制，支持异步等待和自动释放
actor NotionSyncConcurrencyLimiter {
    private let maxConcurrent: Int
    private var availablePermits: Int
    private var waitingTasks: [CheckedContinuation<Void, Never>] = []
    
    /// 初始化限流器
    /// - Parameter maxConcurrent: 最大并发数，默认为 NotionSyncConfig.defaultMaxConcurrentSyncs
    init(maxConcurrent: Int = NotionSyncConfig.defaultMaxConcurrentSyncs) {
        self.maxConcurrent = maxConcurrent
        self.availablePermits = maxConcurrent
    }
    
    /// 执行需要许可的操作
    /// - Parameter operation: 需要在许可保护下执行的异步操作
    /// - Returns: 操作的返回值
    /// - Throws: 操作可能抛出的错误
    func withPermit<T>(_ operation: @Sendable () async throws -> T) async rethrows -> T {
        await acquire()
        defer { Task { await self.release() } }
        return try await operation()
    }
    
    /// 获取一个许可（私有方法）
    /// 如果没有可用许可，会挂起当前任务直到有许可释放
    private func acquire() async {
        if availablePermits > 0 {
            availablePermits -= 1
            return
        }
        
        // 没有可用许可，挂起当前任务
        await withCheckedContinuation { continuation in
            waitingTasks.append(continuation)
        }
    }
    
    /// 释放一个许可（私有方法）
    /// 如果有等待的任务，会唤醒队列中的第一个任务
    private func release() {
        if let next = waitingTasks.first {
            waitingTasks.removeFirst()
            next.resume()
        } else {
            availablePermits += 1
        }
    }
    
    /// 获取当前可用许可数（用于调试和测试）
    func getAvailablePermits() -> Int {
        return availablePermits
    }
    
    /// 获取等待队列长度（用于调试和测试）
    func getWaitingCount() -> Int {
        return waitingTasks.count
    }
}

