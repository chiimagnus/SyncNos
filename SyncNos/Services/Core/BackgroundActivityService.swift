import Foundation

/// 基于 NSBackgroundActivityScheduler 的后台活动服务
final class BackgroundActivityService: BackgroundActivityServiceProtocol {
    private let defaultsKey = "backgroundActivity.enabled"
    private let intervalSeconds: TimeInterval = 24 * 60 * 60
    private let toleranceSeconds: TimeInterval = 60 * 60
    private var scheduler: NSBackgroundActivityScheduler?
    
    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: defaultsKey)
    }
    
    func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: defaultsKey)
        if enabled {
            scheduleIfNeeded()
        } else {
            invalidate()
        }
    }
    
    func startIfEnabled() {
        guard isEnabled else { return }
        scheduleIfNeeded()
    }
    
    // MARK: - Private
    private func scheduleIfNeeded() {
        if scheduler != nil { return }
        let identifier = makeIdentifier()
        let s = NSBackgroundActivityScheduler(identifier: identifier)
        s.repeats = true
        s.interval = intervalSeconds
        s.tolerance = toleranceSeconds
        s.qualityOfService = .utility
        s.schedule { completion in
            // 执行应用内自动同步
            DIContainer.shared.autoSyncService.triggerSyncNow()
            completion(.finished)
        }
        scheduler = s
    }
    
    private func invalidate() {
        scheduler?.invalidate()
        scheduler = nil
    }
    
    private func makeIdentifier() -> String {
        let base = Bundle.main.bundleIdentifier ?? "com.chiimagnus.SyncNos"
        return base + ".background-activity"
    }
}


