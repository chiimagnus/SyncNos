import Foundation
import AppKit

/// 简单的无界面 Helper 程序入口，用于在用户登录后驻留并按计划触发同步。
@main
struct BackgroundHelperApp {
    static func main() {
        // 尝试恢复书签并开始安全访问
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            DIContainer.shared.loggerService.info("BackgroundHelper restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            DIContainer.shared.loggerService.info("BackgroundHelper: no bookmark to restore")
        }

        // 根据 App Group 中的全局开关决定是否启用 AutoSyncService
        let anyEnabled = SharedDefaults.shared.bool(forKey: "autoSyncEnabled")
        if anyEnabled {
            DIContainer.shared.autoSyncService.start()
        }

        // 启动时触发一次即时同步
        DIContainer.shared.loggerService.info("BackgroundHelper: trigger immediate sync")
        DIContainer.shared.autoSyncService.triggerSyncNow()

        // 使用 NSBackgroundActivityScheduler 做周期性唤起（进程常驻时有效）
        let scheduler = NSBackgroundActivityScheduler(identifier: "com.chiimagnus.macOS.autosync")
        scheduler.repeats = true
        scheduler.interval = 24 * 60 * 60 // 24 小时
        scheduler.schedule { completion in
            DIContainer.shared.loggerService.info("BackgroundHelper: scheduled sync fired")
            DIContainer.shared.autoSyncService.triggerSyncNow()
            completion(.finished)
        }

        // 让 runloop 保持运行，等待系统或用户停止 Helper
        RunLoop.current.run()
    }
}


