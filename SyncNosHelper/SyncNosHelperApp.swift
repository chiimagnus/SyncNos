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
        
        // 触发自动同步（异步执行，完成后退出）
        Task {
            do {
                // 触发同步
                DIContainer.shared.autoSyncService.triggerSyncNow()
                
                // 等待一段时间让同步任务启动（不阻塞主线程）
                try await Task.sleep(nanoseconds: 2_000_000_000) // 2秒
                
                logger.info("Helper: Background sync triggered, exiting")
                exit(0)
            } catch {
                logger.error("Helper: Error during sync: \(error.localizedDescription)")
                exit(1)
            }
        }
        
        // 保持运行直到任务完成（最多等待30秒）
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 30))
        logger.info("Helper: Timeout reached, exiting")
        exit(0)
    }
}
