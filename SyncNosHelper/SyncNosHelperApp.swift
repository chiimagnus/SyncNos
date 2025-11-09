//
//  SyncNosHelperApp.swift
//  SyncNosHelper
//
//  Created by chii_magnus on 2025/11/9.
//

import Foundation
import AppKit

/// SyncNos Helper App - 后台同步助手
/// 此Helper应用通过SMAppService注册为Login Item，在系统后台运行并执行自动同步任务
@main
final class SyncNosHelperApp {
    private let logger = DIContainer.shared.loggerService
    
    static func main() {
        _ = SyncNosHelperApp()
        RunLoop.main.run()
    }
    
    init() {
        // Helper启动时执行同步任务
        logger.info("SyncNosHelper started")
        
        // 恢复书签访问权限（如果存在）
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            logger.info("Helper restored bookmark: \(url.path), startAccess=\(started)")
        }
        
        // 执行自动同步
        performSync()
    }
    
    private func performSync() {
        logger.info("Helper: Starting background sync")
        
        // 检查Notion是否已配置
        let notionConfig = DIContainer.shared.notionConfigStore
        guard notionConfig.isConfigured else {
            logger.warning("Helper: Notion not configured, skipping sync")
            exit(0)
            return
        }
        
        // 启动同步并等待真正完成（或整体超时）
        Task {
            // 触发同步
            DIContainer.shared.autoSyncService.triggerSyncNow()
            
            // 轮询 SyncActivityMonitor 直到安静期结束或整体超时
            let monitor = DIContainer.shared.syncActivityMonitor
            var lastActive = Date()
            let overallDeadline = Date().addingTimeInterval(20 * 60) // 最长等待20分钟
            let quietSeconds: TimeInterval = 10
            
            if monitor.isSyncing { lastActive = Date() }
            
            while Date() < overallDeadline {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1s
                if monitor.isSyncing {
                    lastActive = Date()
                } else if Date().timeIntervalSince(lastActive) > quietSeconds {
                    logger.info("Helper: Sync finished (quiet), exiting")
                    exit(0)
                }
            }
            logger.info("Helper: Overall timeout reached, exiting")
            exit(0)
        }
    }
}
