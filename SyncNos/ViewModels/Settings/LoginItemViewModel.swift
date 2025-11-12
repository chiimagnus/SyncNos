import Foundation
import Combine
import SwiftUI

final class LoginItemViewModel: ObservableObject {
    @Published var isEnabled: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let service: LoginItemServiceProtocol
    private var cancellables = Set<AnyCancellable>()
    /// 标志位：区分用户操作和系统状态更新
    private var isUserAction: Bool = false

    init(service: LoginItemServiceProtocol = DIContainer.shared.loginItemService) {
        self.service = service
        // 默认在 UI 上显示为关闭，随后异步查询真实状态并更新（避免初始闪烁）
        self.isEnabled = false
        refreshStatus()
    }

    /// 刷新状态（从系统读取实际状态，不触发setEnabled）
    /// 用于监听系统设置中的变化
    func refreshStatus() {
        DispatchQueue.global(qos: .userInitiated).async {
            let registered = self.service.isRegistered()
            DispatchQueue.main.async {
                // 只有在非用户操作时才更新状态，避免与用户操作冲突
                if !self.isUserAction {
                    self.isEnabled = registered
                }
            }
        }
    }

    /// 用户手动设置启用/禁用（只在用户操作toggle时调用）
    func setEnabled(_ enabled: Bool) {
        guard !isLoading else { return }
        
        // 标记为用户操作
        isUserAction = true
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try service.setEnabled(enabled)
                DispatchQueue.main.async {
                    self.isEnabled = enabled
                    self.isLoading = false
                    // 重置用户操作标志位
                    self.isUserAction = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    // 发生错误时，刷新实际状态
                    let actualStatus = self.service.isRegistered()
                    self.isEnabled = actualStatus
                    self.isLoading = false
                    // 重置用户操作标志位
                    self.isUserAction = false
                }
            }
        }
    }
}


