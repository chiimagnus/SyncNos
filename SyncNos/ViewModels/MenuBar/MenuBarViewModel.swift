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

    // MARK: - Dependencies
    private let autoSyncService: AutoSyncServiceProtocol
    private let queueStore: SyncQueueStoreProtocol
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init
    init(
        autoSyncService: AutoSyncServiceProtocol = DIContainer.shared.autoSyncService,
        queueStore: SyncQueueStoreProtocol = DIContainer.shared.syncQueueStore
    ) {
        self.autoSyncService = autoSyncService
        self.queueStore = queueStore
        self.autoSyncAppleBooks = UserDefaults.standard.bool(forKey: "autoSync.appleBooks")
        self.autoSyncGoodLinks = UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
        self.isAutoSyncRunning = autoSyncService.isRunning

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
    }

    // MARK: - Actions
    func syncAppleBooksNow() {
        autoSyncService.triggerAppleBooksNow()
        refreshAutoSyncRunning()
    }

    func syncGoodLinksNow() {
        autoSyncService.triggerGoodLinksNow()
        refreshAutoSyncRunning()
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


