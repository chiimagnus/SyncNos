import Foundation

/// A simple async concurrency limiter using an actor-based semaphore.
actor ConcurrencyLimiter {
    private let limit: Int
    private var permitsAvailable: Int
    
    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Void, Error>
    }
    
    private var waitQueue: [Waiter] = []
    private var cancelledWaiterIds: Set<UUID> = []
    private var recentlyResumedWaiterIds: [UUID] = []
    private var recentlyResumedWaiterIdSet: Set<UUID> = []
    private let recentlyResumedLimit: Int = 64

    init(limit: Int) {
        precondition(limit > 0, "Concurrency limit must be greater than zero")
        self.limit = limit
        self.permitsAvailable = limit
    }

    private func acquire() async throws {
        try Task.checkCancellation()
        if permitsAvailable > 0 {
            permitsAvailable -= 1
            return
        }
        
        let waiterId = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if cancelledWaiterIds.remove(waiterId) != nil {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                
                waitQueue.append(Waiter(id: waiterId, continuation: continuation))
            }
        } onCancel: {
            Task { await self.cancelWaiter(id: waiterId) }
        }
    }
    
    private func cancelWaiter(id: UUID) {
        guard let index = waitQueue.firstIndex(where: { $0.id == id }) else {
            if recentlyResumedWaiterIdSet.contains(id) {
                return
            }
            cancelledWaiterIds.insert(id)
            return
        }
        let waiter = waitQueue.remove(at: index)
        waiter.continuation.resume(throwing: CancellationError())
    }
    
    private func markResumed(id: UUID) {
        recentlyResumedWaiterIds.append(id)
        recentlyResumedWaiterIdSet.insert(id)
        
        if recentlyResumedWaiterIds.count > recentlyResumedLimit {
            let overflow = recentlyResumedWaiterIds.count - recentlyResumedLimit
            for _ in 0..<overflow {
                let old = recentlyResumedWaiterIds.removeFirst()
                recentlyResumedWaiterIdSet.remove(old)
            }
        }
    }

    private func release() {
        if !waitQueue.isEmpty {
            let next = waitQueue.removeFirst()
            markResumed(id: next.id)
            next.continuation.resume(returning: ())
        } else {
            permitsAvailable += 1
        }
    }

    /// Run an async operation with a limited number of concurrent executions.
    @discardableResult
    func withPermit<T>(_ operation: () async throws -> T) async throws -> T {
        try await acquire()
        defer { release() }
        try Task.checkCancellation()
        return try await operation()
    }
}
