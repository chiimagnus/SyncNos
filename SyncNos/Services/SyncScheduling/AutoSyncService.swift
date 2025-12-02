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

    /// 全局自动同步间隔（目前固定为 24 小时，后续可做成设置项）
    private let intervalSeconds: TimeInterval

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        providers: [SyncSource: AutoSyncSourceProvider]? = nil,
        intervalSeconds: TimeInterval = 24 * 60 * 60
    ) {
        self.logger = logger
        self.notionConfig = notionConfig
        self.intervalSeconds = intervalSeconds

        if let providers {
            self.providers = providers
        } else {
            let apple = AppleBooksAutoSyncProvider(intervalSeconds: intervalSeconds, logger: logger)
            let goodLinks = GoodLinksAutoSyncProvider(intervalSeconds: intervalSeconds, logger: logger)
            let weRead = WeReadAutoSyncProvider(intervalSeconds: intervalSeconds, logger: logger)
            self.providers = [
                .appleBooks: apple,
                .goodLinks: goodLinks,
                .weRead: weRead
            ]
        }
    }

    // MARK: - AutoSyncServiceProtocol

    var isRunning: Bool {
        timerCancellable != nil
    }

    func start() {
        guard timerCancellable == nil else { return }
        logger.info("AutoSyncService starting…")

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
    }

    func stop() {
        timerCancellable?.cancel(); timerCancellable = nil
        notificationCancellable?.cancel(); notificationCancellable = nil
        logger.info("AutoSyncService stopped")
    }

    func triggerSyncNow() {
        guard notionConfig.isConfigured else {
            logger.warning("AutoSync skipped: Notion not configured")
            return
        }
        for provider in providers.values {
            provider.triggerScheduledSyncIfEnabled()
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
