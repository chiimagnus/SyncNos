import Foundation
import Combine

@MainActor
final class BackgroundActivityViewModel: ObservableObject {
    @Published var isEnabled: Bool = SharedDefaults.shared.bool(forKey: "backgroundActivity.enabled")
    @Published var statusText: String = "Unknown"
    private var cancellables = Set<AnyCancellable>()

    init() {
        updateStatus()
    }

    func updateStatus() {
        let s = BackgroundLoginItemService.currentStatus()
        switch s {
        case .enabled:
            statusText = "Registered and enabled"
        case .notRegistered:
            statusText = "Not registered"
        case .requiresApproval:
            statusText = "Registered but requires user approval in System Settings"
        case .notFound:
            statusText = "Helper not found in bundle"
        @unknown default:
            statusText = "Status: \(s)"
        }
    }

    func setEnabled(_ enabled: Bool) {
        Task {
            do {
                if enabled {
                    try BackgroundLoginItemService.register()
                } else {
                    try BackgroundLoginItemService.unregister()
                }
                SharedDefaults.shared.set(enabled, forKey: "backgroundActivity.enabled")
                await MainActor.run { self.isEnabled = enabled; self.updateStatus() }
            } catch {
                // If registration fails, keep persisted value and update status
                await MainActor.run {
                    self.isEnabled = SharedDefaults.shared.bool(forKey: "backgroundActivity.enabled")
                    self.statusText = "Error: \(error.localizedDescription)"
                }
            }
        }
    }

    func openSystemSettings() {
        BackgroundLoginItemService.openSystemSettingsLoginItems()
    }
}


