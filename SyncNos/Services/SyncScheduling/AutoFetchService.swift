import Foundation
import Combine

/// 统一编排各个来源（当前仅 GoodLinks）的自动预取提供者。
///
/// 说明：
/// - 自动预取与 Notion 同步相互独立
/// - 自动预取为“强制开启”，但各 provider 必须自行检查数据源是否启用并做 no-op
final class AutoFetchService: AutoFetchServiceProtocol {
    private let logger: LoggerServiceProtocol
    private let providers: [ContentSource: AutoFetchSourceProvider]

    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?

    /// 全局自动预取间隔：推进一轮扫描与抓取。
    private let intervalSeconds: TimeInterval

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        providers: [ContentSource: AutoFetchSourceProvider]? = nil,
        intervalSeconds: TimeInterval = 5 * 60
    ) {
        self.logger = logger
        if let providers {
            self.providers = providers
        } else {
            let goodLinks = GoodLinksAutoFetchProvider(logger: logger)
            self.providers = [
                .goodLinks: goodLinks
            ]
        }
        self.intervalSeconds = intervalSeconds
    }

    // MARK: - AutoFetchServiceProtocol

    var isRunning: Bool {
        timerCancellable != nil
    }

    func start() {
        guard timerCancellable == nil else { return }
        logger.info("[AutoFetch] AutoFetchService starting…")

        // GoodLinks 授权完成后，推进一次预取（provider 内部会判断是否启用）
        notificationCancellable = NotificationCenter.default.publisher(for: .goodLinksFolderSelected)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.triggerFetchNow()
            }

        timerCancellable = Timer.publish(every: intervalSeconds, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.triggerFetchNow()
            }

        // 启动后立即推进一次，避免用户等待第一个周期
        triggerFetchNow()
    }

    func stop() {
        timerCancellable?.cancel(); timerCancellable = nil
        notificationCancellable?.cancel(); notificationCancellable = nil
        logger.info("[AutoFetch] AutoFetchService stopped")
    }

    func triggerFetchNow() {
        for provider in providers.values {
            provider.triggerScheduledFetch()
        }
    }
}
