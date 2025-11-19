import SwiftUI
import AppKit

struct MenuBarView: View {
    @StateObject private var viewModel = MenuBarViewModel()
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        // MARK: - Window Management
        Button("Open SyncNos") {
            openWindow(id: "main")
        }
        
        Divider()
        
        // MARK: - Sync Queue Status
        Label("\(viewModel.runningCount) Running", systemImage: "arrow.triangle.2.circlepath")
            .font(.caption)
            .foregroundStyle(.secondary)
        Label("\(viewModel.queuedCount) Waiting", systemImage: "clock")
            .font(.caption)
            .foregroundStyle(.secondary)
        Label("\(viewModel.failedCount) Failed", systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.red)
        
        Divider()
        
        // MARK: - Quit Application
        Button {
            quitApplication()
        } label: {
            Label("Quit SyncNos", systemImage: "power")
        }
    }
    
    private func quitApplication() {
        NotificationCenter.default.post(name: Notification.Name("BypassQuitConfirmationOnce"), object: nil)
        NSApp.terminate(nil)
    }
}

