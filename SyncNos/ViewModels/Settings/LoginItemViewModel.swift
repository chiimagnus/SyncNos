import Foundation
import Combine

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
}


