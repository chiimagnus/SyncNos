import Foundation

/// A simple async concurrency limiter using an actor-based semaphore.
actor ConcurrencyLimiter {
    private let limit: Int
    private var permitsAvailable: Int
    private var waitQueue: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) {
        precondition(limit > 0, "Concurrency limit must be greater than zero")
        self.limit = limit
        self.permitsAvailable = limit
    }

    private func acquire() async {
        if permitsAvailable > 0 {
            permitsAvailable -= 1
            return
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            waitQueue.append(continuation)
        }
    }

    private func release() {
        if !waitQueue.isEmpty {
            let next = waitQueue.removeFirst()
            next.resume()
        } else {
            permitsAvailable += 1
        }
    }

    /// Run an async operation with a limited number of concurrent executions.
    @discardableResult
    func withPermit<T>(_ operation: () async throws -> T) async rethrows -> T {
        await acquire()
        defer { release() }
        return try await operation()
    }
}


