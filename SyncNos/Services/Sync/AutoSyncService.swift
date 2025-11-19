import Foundation
import Combine

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

final class AutoSyncService: AutoSyncServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let notionConfig = DIContainer.shared.notionConfigStore

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?

    private let intervalSeconds: TimeInterval = 24 * 60 * 60 // 24小时，后续可做成设置项

    var isRunning: Bool {
        timerCancellable != nil
    }

    func start() {
        guard timerCancellable == nil else { return }
        logger.info("AutoSyncService starting…")
        // 监听数据源选择完成或刷新事件，触发一次同步
        notificationCancellable = NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))
            .merge(with: NotificationCenter.default.publisher(for: Notification.Name("GoodLinksFolderSelected")))
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
        
        // Iterate over all registered providers and trigger them
        for provider in DIContainer.shared.syncProviders {
            triggerProvider(provider)
        }
    }

    // New public per-source triggers
    func triggerAppleBooksNow() {
        if let provider = DIContainer.shared.syncProviders.first(where: { $0.source == .appleBooks }) {
            triggerProvider(provider)
        }
    }

    func triggerGoodLinksNow() {
        if let provider = DIContainer.shared.syncProviders.first(where: { $0.source == .goodLinks }) {
            triggerProvider(provider)
        }
    }
    
    private func triggerProvider(_ provider: SyncSourceProvider) {
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            do {
                try await provider.triggerAutoSync()
            } catch {
                self.logger.error("AutoSync[\(provider.source)] error: \(error.localizedDescription)")
            }
        }
    }
}
