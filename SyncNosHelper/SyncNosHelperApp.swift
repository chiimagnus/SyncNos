import Foundation
import AppKit
import Combine

/// SyncNos Helper App - 后台同步助手（常驻模式）
/// 通过 SMAppService 注册为 Login Item，在系统后台常驻并管理自动同步与状态栏。
@main
final class SyncNosHelperApp {
    private let logger = DIContainer.shared.loggerService
    private var cancellables = Set<AnyCancellable>()
    private var statusBarController: StatusBarController?
    
    static func main() {
        let app = NSApplication.shared
        _ = SyncNosHelperApp()
        app.run()
    }
    
    init() {
        logger.info("SyncNosHelper launched (persistent)")
        // 初始化状态栏菜单控制器（Helper 常驻时提供快速触发入口）
        statusBarController = StatusBarController()
        
        // 恢复书签（Apple Books / GoodLinks）
        if let url = BookmarkStore.shared.restore() { _ = BookmarkStore.shared.startAccessing(url: url) }
        if let gl = GoodLinksBookmarkStore.shared.restore() { _ = GoodLinksBookmarkStore.shared.startAccessing(url: gl) }
        
        // 常驻启动 AutoSyncService（内部根据 per-source 开关决定是否执行实际任务）
        DIContainer.shared.autoSyncService.start()
        
        // 若已配置且任一来源开启，首次启动触发一次
        let anyEnabled = SharedDefaults.userDefaults.bool(forKey: "autoSync.appleBooks") || SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks")
        if DIContainer.shared.notionConfigStore.isConfigured && anyEnabled {
            DIContainer.shared.autoSyncService.triggerSyncNow()
        }
        
        // 初始化监控&队列（供状态栏展示）
        _ = DIContainer.shared.syncActivityMonitor
        _ = DIContainer.shared.syncQueueStore
    }
}
