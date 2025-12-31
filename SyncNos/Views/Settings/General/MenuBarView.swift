import SwiftUI

struct MenuBarView: View {
    @StateObject private var viewModel = MenuBarViewModel()
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        // MARK: - Window Management
        Button("Open SyncNos") {
            NSApp.activate(ignoringOtherApps: true) // 强制将应用带到前台
            openWindow(id: "main") // 打开或聚焦主窗口
        }
        
        Divider()
        
        // MARK: - Smart Sync Status
        if viewModel.isAutoSyncRunning, let nextSyncFormatted = viewModel.nextSyncTimeFormatted {
            Label("Next sync: \(nextSyncFormatted)", systemImage: "clock.arrow.circlepath")
                .scaledFont(.caption)
                .foregroundStyle(.secondary)
            
            Divider()
        }
        
        // MARK: - Sync Queue Status
        Label("\(viewModel.runningCount) Running", systemImage: "arrow.triangle.2.circlepath")
            .scaledFont(.caption)
            .foregroundStyle(.secondary)
        Label("\(viewModel.queuedCount) Waiting", systemImage: "clock")
            .scaledFont(.caption)
            .foregroundStyle(.secondary)
        Label("\(viewModel.failedCount) Failed", systemImage: "exclamationmark.triangle")
            .scaledFont(.caption)
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
