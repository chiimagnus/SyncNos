import SwiftUI

struct MenuBarView: View {
    @StateObject private var viewModel = MenuBarViewModel()
    @Environment(\.openWindow) private var openWindow
    
    // MARK: - Hover Button
    
    private struct HoverMenuButton<Label: View>: View {
        let action: () -> Void
        @ViewBuilder let label: () -> Label
        
        @State private var isHovering: Bool = false
        
        var body: some View {
            Button(action: action) {
                label()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isHovering ? Color.primary.opacity(0.08) : Color.clear)
            )
            .onHover { hovering in
                isHovering = hovering
            }
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // MARK: - Window Management
            HoverMenuButton(action: {
                NSApp.activate(ignoringOtherApps: true) // 强制将应用带到前台
                openWindow(id: "main") // 打开或聚焦主窗口
            }) {
                Text("Open SyncNos")
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
            VStack(alignment: .leading, spacing: 4) {
                Label("\(viewModel.runningCount) Running", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                Label("\(viewModel.queuedCount) Waiting", systemImage: "clock")
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                Label("\(viewModel.failedCount) Failed", systemImage: "exclamationmark.triangle")
                    .scaledFont(.caption)
                    .foregroundStyle(.red)
            }
            
            Divider()
            
            // MARK: - Quit Application
            HoverMenuButton(action: {
                quitApplication()
            }) {
                Label("Quit SyncNos", systemImage: "power")
            }
        }
        .padding(10)
        .frame(width: 240, alignment: .leading)
    }
    
    private func quitApplication() {
        NotificationCenter.default.post(name: .bypassQuitConfirmationOnce, object: nil)
        NSApp.terminate(nil)
    }
}
