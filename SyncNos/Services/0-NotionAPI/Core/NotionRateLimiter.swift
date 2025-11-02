import Foundation

/// 全局 Notion 请求节流器（简单漏桶/固定间隔）。
/// 保证全应用范围内对 Notion 的请求不超过设定 RPS。
actor NotionRateLimiter {
    private let rps: Int
    private let minIntervalNs: UInt64
    private var lastAcquiredAtNs: UInt64?

    init(rps: Int) {
        self.rps = max(1, rps)
        self.minIntervalNs = 1_000_000_000 / UInt64(self.rps)
    }

    func acquire() async {
        let now = DispatchTime.now().uptimeNanoseconds
        if let last = lastAcquiredAtNs {
            let elapsed = now &- last
            if elapsed < minIntervalNs {
                let base = minIntervalNs &- elapsed
                let jitter = UInt64.random(in: 0...(NotionSyncConfig.retryJitterMs * 1_000_000))
                let wait = base &+ jitter
                try? await Task.sleep(nanoseconds: wait)
            }
        }
        lastAcquiredAtNs = DispatchTime.now().uptimeNanoseconds
    }
}
