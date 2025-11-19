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

        // MARK: - Sync Actions
        Button {
            viewModel.syncAppleBooksNow()
        } label: {
            Label("Sync Apple Books", systemImage: "book")
        }
        
        Button {
            viewModel.syncGoodLinksNow()
        } label: {
            Label("Sync GoodLinks", systemImage: "bookmark")
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
        .alert("Notion Configuration Required", isPresented: $viewModel.showNotionConfigAlert) {
            Button("Go to Settings") {
                openWindow(id: "setting")
                // 延迟一下确保窗口已经打开，然后导航到 Notion 配置页面
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    NotificationCenter.default.post(name: Notification.Name("NavigateToNotionSettings"), object: nil)
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Please configure Notion API Key and Page ID before syncing.")
        }
    }
    
    private func quitApplication() {
        NotificationCenter.default.post(name: Notification.Name("BypassQuitConfirmationOnce"), object: nil)
        NSApp.terminate(nil)
    }
}

