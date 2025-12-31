import Foundation
import Combine

// MARK: - Database Path Helper
//
/// 负责解析 Apple Books 数据根目录的辅助工具，供 ViewModel 与 AutoSync 使用
final class DatabasePathHelper {
    static func determineDatabaseRoot(from selectedPath: String) -> String {
        let fm = FileManager.default
        var rootCandidate = selectedPath

        // 检查是否选择了容器目录（包含Data/Documents）
        let maybeDataDocs = (selectedPath as NSString).appendingPathComponent("Data/Documents")
        let aeAnnoInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("AEAnnotation")
        let bkLibInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("BKLibrary")

        if fm.fileExists(atPath: aeAnnoInDataDocs) || fm.fileExists(atPath: bkLibInDataDocs) {
            rootCandidate = maybeDataDocs
        } else {
            // 检查是否直接选择了Data/Documents目录
            let aeAnno = (selectedPath as NSString).appendingPathComponent("AEAnnotation")
            let bkLib = (selectedPath as NSString).appendingPathComponent("BKLibrary")
            if fm.fileExists(atPath: aeAnno) || fm.fileExists(atPath: bkLib) {
                rootCandidate = selectedPath
            }
            // 如果用户选择了 `.../Data`，则自动补上 `Documents`
            let lastPath = (selectedPath as NSString).lastPathComponent
            if lastPath == "Data" {
                let dataDocs = (selectedPath as NSString).appendingPathComponent("Documents")
                let aeAnno2 = (dataDocs as NSString).appendingPathComponent("AEAnnotation")
                let bkLib2 = (dataDocs as NSString).appendingPathComponent("BKLibrary")
                if fm.fileExists(atPath: aeAnno2) || fm.fileExists(atPath: bkLib2) {
                    rootCandidate = dataDocs
                }
            }
            // 如果用户选择了容器根 `.../Containers/com.apple.iBooksX`，则进入 `Data/Documents`
            if lastPath == "com.apple.iBooksX" || selectedPath.hasSuffix("/Containers/com.apple.iBooksX") {
                let containerDocs = (selectedPath as NSString).appendingPathComponent("Data/Documents")
                let aeAnno3 = (containerDocs as NSString).appendingPathComponent("AEAnnotation")
                let bkLib3 = (containerDocs as NSString).appendingPathComponent("BKLibrary")
                if fm.fileExists(atPath: aeAnno3) || fm.fileExists(atPath: bkLib3) {
                    rootCandidate = containerDocs
                }
            }
        }

        return rootCandidate
    }
}

/// 统一编排各个来源（Apple Books / GoodLinks / 未来的 WeRead）的自动同步提供者
final class AutoSyncService: AutoSyncServiceProtocol {
    private let logger: LoggerServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let providers: [SyncSource: AutoSyncSourceProvider]

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?

    /// 全局自动同步间隔（智能增量同步：检查一次，只同步有变更的内容）
    /// TODO: 测试完成后改回 5 * 60（5 分钟）
    private let intervalSeconds: TimeInterval
    
    /// Subject for next sync time updates
    private let nextSyncTimeSubject = CurrentValueSubject<Date?, Never>(nil)

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        providers: [SyncSource: AutoSyncSourceProvider]? = nil,
        intervalSeconds: TimeInterval = 5 * 60  // 5分钟
    ) {
        self.logger = logger
        self.notionConfig = notionConfig
        self.intervalSeconds = intervalSeconds

        if let providers {
            self.providers = providers
        } else {
            let apple = AppleBooksAutoSyncProvider(logger: logger)
            let goodLinks = GoodLinksAutoSyncProvider(logger: logger)
            let weRead = WeReadAutoSyncProvider(logger: logger)
            let dedao = DedaoAutoSyncProvider(logger: logger)
            self.providers = [
                .appleBooks: apple,
                .goodLinks: goodLinks,
                .weRead: weRead,
                .dedao: dedao
            ]
        }
    }

    // MARK: - AutoSyncServiceProtocol

    var isRunning: Bool {
        timerCancellable != nil
    }
    
    var nextSyncTime: Date? {
        nextSyncTimeSubject.value
    }
    
    var nextSyncTimePublisher: AnyPublisher<Date?, Never> {
        nextSyncTimeSubject.eraseToAnyPublisher()
    }
    
    /// Update the next sync time based on current time + interval
    private func updateNextSyncTime() {
        nextSyncTimeSubject.send(Date().addingTimeInterval(intervalSeconds))
    }
    
    /// Clear the next sync time (when service stops)
    private func clearNextSyncTime() {
        nextSyncTimeSubject.send(nil)
    }

    func start() {
        guard timerCancellable == nil else { return }
        logger.info("[SmartSync] AutoSyncService starting…")

        // 监听数据源选择完成或刷新事件，触发一次同步（Apple Books、GoodLinks、WeRead）
        notificationCancellable = NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("WeReadLoginSucceeded")))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.triggerSyncNow()
            }

        // 定时增量同步
        timerCancellable = Timer.publish(every: intervalSeconds, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.triggerSyncNow()
            }
        
        // Set initial next sync time
        updateNextSyncTime()
    }

    func stop() {
        timerCancellable?.cancel(); timerCancellable = nil
        notificationCancellable?.cancel(); notificationCancellable = nil
        clearNextSyncTime()
        logger.info("[SmartSync] AutoSyncService stopped")
    }

    func triggerSyncNow() {
        guard notionConfig.isConfigured else {
            logger.warning("[SmartSync] skipped: Notion not configured")
            return
        }
        for provider in providers.values {
            provider.triggerScheduledSyncIfEnabled()
        }
        // Update next sync time after triggering sync
        if isRunning {
            updateNextSyncTime()
        }
    }

    // MARK: - Public per-source triggers

    func triggerAppleBooksNow() {
        providers[.appleBooks]?.triggerManualSyncNow()
    }

    func triggerGoodLinksNow() {
        providers[.goodLinks]?.triggerManualSyncNow()
    }

    func triggerWeReadNow() {
        providers[.weRead]?.triggerManualSyncNow()
    }

    func triggerDedaoNow() {
        providers[.dedao]?.triggerManualSyncNow()
    }
}
