import Foundation

enum OrderedTaskRunner {
    /// 按 ids 顺序启动任务，并保持最大并发数（滑动窗口并发）：
    /// - 先启动前 `concurrency` 个
    /// - 任意一个完成后，立即启动下一个
    static func runOrdered(
        ids: [String],
        concurrency: Int,
        operation: @escaping (String) async -> Void
    ) async {
        guard !ids.isEmpty else { return }
        let maxConcurrent = max(concurrency, 1)
        var nextIndex = 0
        
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < ids.count else { return }
                let id = ids[nextIndex]
                nextIndex += 1
                group.addTask {
                    await operation(id)
                }
            }
            
            for _ in 0..<min(maxConcurrent, ids.count) {
                addTaskIfPossible()
            }
            
            while await group.next() != nil {
                addTaskIfPossible()
            }
        }
    }
}

