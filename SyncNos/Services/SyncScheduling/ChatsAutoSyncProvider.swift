import Foundation

/// Chats 自动同步提供者
///
/// **设计说明**：
/// 与其他数据源（Apple Books、GoodLinks、WeRead、Dedao）不同，Chats 数据完全由用户本地管理：
/// - 数据来源于用户导入的截图，而非外部应用/服务
/// - 无外部变化源，不像其他数据源可能有外部更新
/// - 用户在编辑完消息分类后手动触发同步更合理
///
/// 因此，Chats 的自动同步逻辑设计为：
/// - 定时同步触发时不执行实际同步（因为没有外部变化需要检测）
/// - 仅提供手动触发接口，供未来扩展使用
final class ChatsAutoSyncProvider: AutoSyncSourceProvider {
    let id: ContentSource = .chats
    let autoSyncUserDefaultsKey: String = "autoSync.chats"
    
    private let logger: LoggerServiceProtocol
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    // MARK: - AutoSyncSourceProvider
    
    func triggerScheduledSyncIfEnabled() {
        let enabled = UserDefaults.standard.bool(forKey: autoSyncUserDefaultsKey)
        guard enabled else { return }
        
        // Chats 目前设计为手动同步，定时触发时不执行实际同步
        // 因为 Chats 数据完全由用户本地管理（导入截图），没有外部变化需要检测
        logger.debug("[SmartSync] Chats: scheduled sync triggered (no-op - manual sync only)")
    }
    
    func triggerManualSyncNow() {
        // 手动触发也仅记录日志，实际同步由用户通过 UI 触发
        // 未来可扩展为：同步所有未同步过的对话
        logger.info("[SmartSync] Chats: manual sync triggered (no-op - use UI to sync)")
    }
}

