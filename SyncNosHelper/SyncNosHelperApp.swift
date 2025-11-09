//
//  SyncNosHelperApp.swift
//  SyncNosHelper
//
//  Created by chii_magnus on 2025/11/9.
//

import Foundation
import AppKit
import Combine

/// SyncNos Helper App - 后台同步助手（常驻模式）
/// 通过 SMAppService 注册为 Login Item，在系统后台常驻并管理自动同步与状态栏。
@main
final class SyncNosHelperApp {
    private let logger = DIContainer.shared.loggerService
    private var cancellables = Set<AnyCancellable>()
    private var statusController: HelperStatusBarController?
    
    static func main() {
        _ = SyncNosHelperApp()
        RunLoop.main.run()
    }
    
    init() {
        logger.info("SyncNosHelper launched (persistent)")
        
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
        
        // 状态栏控制器
        statusController = HelperStatusBarController()
    }
}
