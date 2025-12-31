import Foundation
import Combine

@MainActor
final class MenuBarViewModel: ObservableObject {
    // MARK: - Published UI States
    @Published var autoSyncAppleBooks: Bool
    @Published var autoSyncGoodLinks: Bool
    @Published private(set) var runningCount: Int = 0
    @Published private(set) var queuedCount: Int = 0
    @Published private(set) var failedCount: Int = 0
    @Published private(set) var isAutoSyncRunning: Bool = false
    @Published private(set) var nextSyncTime: Date?
    // 注：showNotionConfigAlert 已移至 MainListView 统一处理

    // MARK: - Dependencies
    private let autoSyncService: AutoSyncServiceProtocol
    private let queueStore: SyncQueueStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init
    init(
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService,
        queueStore: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.autoSyncService = autoSyncService
        self.queueStore = queueStore
        self.notionConfig = notionConfig
        self.autoSyncAppleBooks = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
        self.autoSyncGoodLinks = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        self.isAutoSyncRunning = autoSyncService.isRunning
        self.nextSyncTime = autoSyncService.nextSyncTime

        // 订阅队列变更以汇总数量
        queueStore.tasksPublisher
            .map { tasks -> (Int, Int, Int) in
                let running = tasks.filter { $0.state == .running }.count
                let queued = tasks.filter { $0.state == .queued }.count
                let failed = tasks.filter { $0.state == .failed }.count
                return (running, queued, failed)
            }
            .sink { [weak self] running, queued, failed in
                self?.runningCount = running
                self?.queuedCount = queued
                self?.failedCount = failed
            }
            .store(in: &cancellables)
        
        // 订阅下次同步时间变更
        autoSyncService.nextSyncTimePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] time in
                self?.nextSyncTime = time
                self?.isAutoSyncRunning = self?.autoSyncService.isRunning ?? false
            }
            .store(in: &cancellables)
    }

    // MARK: - Computed Properties
    
    /// Formatted string for next sync time display
    var nextSyncTimeFormatted: String? {
        guard let time = nextSyncTime else { return nil }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: time)
    }

    // MARK: - Actions
    func syncAppleBooksNow() {
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        autoSyncService.triggerAppleBooksNow()
        refreshAutoSyncRunning()
    }

    func syncGoodLinksNow() {
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        autoSyncService.triggerGoodLinksNow()
        refreshAutoSyncRunning()
    }
    
    // MARK: - Configuration Validation
    private func checkNotionConfig() -> Bool {
        return notionConfig.isConfigured
    }

    func setAutoSyncAppleBooks(_ enabled: Bool) {
        autoSyncAppleBooks = enabled
        UserDefaults.standard.set(enabled, forKey: "autoSync.appleBooks")
        applyAutoSyncLifecycleAndMaybeKickstart(sourceJustEnabled: enabled ? "appleBooks" : nil)
    }

    func setAutoSyncGoodLinks(_ enabled: Bool) {
        autoSyncGoodLinks = enabled
        UserDefaults.standard.set(enabled, forKey: "autoSync.goodLinks")
        applyAutoSyncLifecycleAndMaybeKickstart(sourceJustEnabled: enabled ? "goodLinks" : nil)
    }

    // MARK: - Helpers
    private func applyAutoSyncLifecycleAndMaybeKickstart(sourceJustEnabled: String?) {
        let anyEnabled = autoSyncAppleBooks || autoSyncGoodLinks
        UserDefaults.standard.set(anyEnabled, forKey: "autoSyncEnabled")
        if anyEnabled {
            autoSyncService.start()
            if sourceJustEnabled == "appleBooks" {
                autoSyncService.triggerAppleBooksNow()
            } else if sourceJustEnabled == "goodLinks" {
                autoSyncService.triggerGoodLinksNow()
            }
        } else {
            autoSyncService.stop()
        }
        refreshAutoSyncRunning()
    }

    private func refreshAutoSyncRunning() {
        isAutoSyncRunning = autoSyncService.isRunning
    }
}
