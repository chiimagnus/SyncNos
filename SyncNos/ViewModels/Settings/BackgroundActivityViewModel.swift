import Foundation
import Combine
import SwiftUI
import ServiceManagement

final class BackgroundActivityViewModel: ObservableObject {
    @Published var preferredEnabled: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var statusText: String = ""
    @Published var showRequiresApprovalAlert: Bool = false

    private let service: BackgroundActivityServiceProtocol
    private var cancellables = Set<AnyCancellable>()

    init(service: BackgroundActivityServiceProtocol = DIContainer.shared.backgroundActivityService) {
        self.service = service
        self.preferredEnabled = service.preferredEnabled
        refreshStatusText()

        // 使用 Timer 定期检查 effectiveStatus 变化
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let currentStatus = self.service.effectiveStatus

            DispatchQueue.main.async {
                let previousStatus = self.lastKnownStatus
                if currentStatus != previousStatus {
                    self.lastKnownStatus = currentStatus
                    self.refreshStatusText()
                    self.checkRequiresApprovalStatus()
                }
            }
        }
        // 将 Timer 添加到 cancellables 中进行管理
        cancellables.insert(AnyCancellable {
            timer.invalidate()
        })

        // 记录初始状态
        lastKnownStatus = service.effectiveStatus
    }

    private var lastKnownStatus: SMAppService.Status = .notRegistered

    private func checkRequiresApprovalStatus() {
        // 如果状态变为 requiresApproval，自动显示 alert
        if service.effectiveStatus == .requiresApproval {
            showRequiresApprovalAlert = true
        }
    }
    
    func setEnabled(_ enabled: Bool) {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        Task {
            do {
                if enabled {
                    // 开启流程
                    let outcome = try service.enableAndLaunch()
                    DispatchQueue.main.async {
                        self.preferredEnabled = true
                        self.isLoading = false
                        self.refreshStatusText()
                        if case .requiresApprovalOpenedSettings = outcome {
                            self.showRequiresApprovalAlert = true
                        }
                    }
                } else {
                    // 关闭流程
                    try service.disable()
                    DispatchQueue.main.async {
                        self.preferredEnabled = false
                        self.isLoading = false
                        self.refreshStatusText()
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                    self.refreshStatusText()
                }
            }
        }
    }

    
    private func refreshStatusText() {
        let status = service.effectiveStatus
        if status == .enabled && service.isHelperRunning {
            statusText = String(localized: "bg.status.enabledRunning", table: "Localizable-2")
        } else if status == .requiresApproval {
            statusText = String(localized: "bg.status.requiresApproval", table: "Localizable-2")
        } else {
            statusText = String(localized: "bg.status.disabled", table: "Localizable-2")
        }
    }
}


