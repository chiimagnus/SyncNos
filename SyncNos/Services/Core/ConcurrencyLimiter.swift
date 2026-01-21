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
                waitQueue.append(Waiter(id: waiterId, continuation: continuation))
            }
        } onCancel: {
            Task { await self.cancelWaiter(id: waiterId) }
        }
        
        try Task.checkCancellation()
    }
    
    private func cancelWaiter(id: UUID) {
        guard let index = waitQueue.firstIndex(where: { $0.id == id }) else { return }
        let waiter = waitQueue.remove(at: index)
        waiter.continuation.resume(throwing: CancellationError())
    }

    private func release() {
        if !waitQueue.isEmpty {
            let next = waitQueue.removeFirst()
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
        return try await operation()
    }
}
