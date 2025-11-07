import Foundation
import Combine
import UserNotifications

import SwiftUI

final class LoginItemViewModel: ObservableObject {
    @Published var isEnabled: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let service: LoginItemServiceProtocol
    private var cancellables = Set<AnyCancellable>()

    init(service: LoginItemServiceProtocol = DIContainer.shared.loginItemService) {
        self.service = service
        // 默认在 UI 上显示为关闭，随后异步查询真实状态并更新（避免初始闪烁）
        self.isEnabled = false
        DispatchQueue.global(qos: .userInitiated).async {
            let registered = service.isRegistered()
            DispatchQueue.main.async {
                self.isEnabled = registered
            }
        }
    }

    func setEnabled(_ enabled: Bool) {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try service.setEnabled(enabled)
                DispatchQueue.main.async {
                    self.isEnabled = enabled
                    self.isLoading = false
                    // Deliver a local system notification to inform the user
                    let title = enabled ? "Open at Login enabled" : "Open at Login disabled"
                    let body = enabled ? "SyncNos will open automatically when you sign in." : "SyncNos will no longer open automatically at sign in."
                    self.deliverSystemNotification(title: title, body: body)
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    // revert toggle to actual state
                    self.isEnabled = self.service.isRegistered()
                    self.isLoading = false
                }
            }
        }
    }

    // MARK: - Notifications
    private func deliverSystemNotification(title: String, body: String) {
        let center = UNUserNotificationCenter.current()
        // Request authorization if needed, then schedule
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.5, repeats: false)
            let request = UNNotificationRequest(identifier: "syncnos.openAtLogin.", content: content, trigger: trigger)
            center.add(request, withCompletionHandler: nil)
        }
    }
}


