import Foundation

/// UserDefaults 变更观察器
/// - 用途：动态 key（如 datasource.xxx.enabled）无法用 @AppStorage 监听时，用此对象触发 SwiftUI 刷新
@MainActor
final class UserDefaultsObserver: ObservableObject {
    @Published private(set) var changeCounter: UInt = 0

    private var token: NSObjectProtocol?

    init() {
        token = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.changeCounter &+= 1
            }
        }
    }

    deinit {
        if let token {
            NotificationCenter.default.removeObserver(token)
        }
    }

    func forceRefresh() {
        changeCounter &+= 1
    }
}
