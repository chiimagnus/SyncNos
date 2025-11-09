import Foundation
import Combine
import SwiftUI

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
    }
    
    func setEnabled(_ enabled: Bool) {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        
        Task {
            do {
                if enabled {
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


