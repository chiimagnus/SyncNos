import Foundation
import Combine

final class SyncQueueStore: SyncQueueStoreProtocol {
    private let notificationCenter: NotificationCenter
    private var cancellables = Set<AnyCancellable>()

    private let stateQueue = DispatchQueue(label: "sync.queue.store.state")
    private var tasksById: [String: SyncQueueTask] = [:]
    private var enqueuedOrder: [String] = []

    private let subject = CurrentValueSubject<[SyncQueueTask], Never>([])

    init(notificationCenter: NotificationCenter = .default) {
        self.notificationCenter = notificationCenter

        // 入队事件
        notificationCenter.publisher(for: Notification.Name("SyncTasksEnqueued"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleEnqueue(info: info)
            }
            .store(in: &cancellables)

        // 运行状态事件（started/succeeded/failed）
        notificationCenter.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleStatusChanged(info: info)
            }
            .store(in: &cancellables)

        // 进度更新事件
        notificationCenter.publisher(for: Notification.Name("SyncProgressUpdated"))
            .compactMap { $0.userInfo as? [String: Any] }
            .sink { [weak self] info in
                guard let self else { return }
                self.handleProgress(info: info)
            }
            .store(in: &cancellables)
    }

    // MARK: - Public
    var snapshot: [SyncQueueTask] {
        stateQueue.sync { orderedTasks() }
    }

    var tasksPublisher: AnyPublisher<[SyncQueueTask], Never> {
        subject
            .receive(on: DispatchQueue.main)
            .eraseToAnyPublisher()
    }

    // MARK: - Private
    private func handleEnqueue(info: [String: Any]) {
        guard let sourceRaw = info["source"] as? String,
              let source = SyncSource(rawValue: sourceRaw),
              let items = info["items"] as? [[String: Any]] else { return }

        var changed = false
        stateQueue.sync {
            for dict in items {
                guard let rawId = dict["id"] as? String,
                      let title = dict["title"] as? String else { continue }
                let subtitle = dict["subtitle"] as? String
                let temp = SyncQueueTask(rawId: rawId, source: source, title: title, subtitle: subtitle, state: .queued)
                if tasksById[temp.id] == nil {
                    tasksById[temp.id] = temp
                    enqueuedOrder.append(temp.id)
                    changed = true
                }
            }
        }
        if changed { publish() }
    }

    private func handleStatusChanged(info: [String: Any]) {
        guard let rawId = info["bookId"] as? String,
              let status = info["status"] as? String else { return }

        var changed = false
        stateQueue.sync {
            for key in enqueuedOrder {
                guard var t = tasksById[key], t.rawId == rawId else { continue }
                switch status {
                case "started": t.state = .running
                case "succeeded": t.state = .succeeded
                case "failed": t.state = .failed
                default: break
                }
                tasksById[key] = t
                changed = true
            }
        }
        if changed { publish() }
    }

    private func handleProgress(info: [String: Any]) {
        guard let rawId = info["bookId"] as? String,
              let progress = info["progress"] as? String else { return }

        var changed = false
        stateQueue.sync {
            for key in enqueuedOrder {
                guard var t = tasksById[key], t.rawId == rawId else { continue }
                t.progressText = progress
                tasksById[key] = t
                changed = true
            }
        }
        if changed { publish() }
    }

    private func orderedTasks() -> [SyncQueueTask] {
        enqueuedOrder.compactMap { tasksById[$0] }
    }

    private func publish() {
        subject.send(stateQueue.sync { orderedTasks() })
    }
}
