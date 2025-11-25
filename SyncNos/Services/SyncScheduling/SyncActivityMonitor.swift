import Foundation
import Combine

// MARK: - Sync Activity Monitor
/// 统一监听应用内各来源的同步状态，供退出拦截等场景查询。
final class SyncActivityMonitor: SyncActivityMonitorProtocol {
    private var cancellables = Set<AnyCancellable>()
    private let stateQueue = DispatchQueue(label: "sync.activity.monitor.state")
    private var activeIds: Set<String> = []

    init(notificationCenter: NotificationCenter = .default) {
        // 监听统一状态事件（ViewModels/AutoSyncService 均会发送）
        notificationCenter.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .sink { [weak self] note in
                guard let self else { return }
                guard let info = note.userInfo as? [String: Any],
                      let bookId = info["bookId"] as? String,
                      let status = info["status"] as? String else { return }
                switch status {
                case "started":
                    self.addActive(id: bookId)
                case "succeeded", "failed":
                    self.removeActive(id: bookId)
                default:
                    break
                }
            }
            .store(in: &cancellables)

        // 兼容 AutoSyncService 的开始/结束事件
        notificationCenter.publisher(for: Notification.Name("SyncBookStarted"))
            .compactMap { $0.object as? String }
            .sink { [weak self] id in self?.addActive(id: id) }
            .store(in: &cancellables)

        notificationCenter.publisher(for: Notification.Name("SyncBookFinished"))
            .compactMap { $0.object as? String }
            .sink { [weak self] id in self?.removeActive(id: id) }
            .store(in: &cancellables)
    }

    // 公开只读属性
    var isSyncing: Bool {
        stateQueue.sync { !activeIds.isEmpty }
    }

    // MARK: - Private helpers
    private func addActive(id: String) {
        stateQueue.sync { _ = activeIds.insert(id) }
    }

    private func removeActive(id: String) {
        stateQueue.sync { _ = activeIds.remove(id) }
    }
}
