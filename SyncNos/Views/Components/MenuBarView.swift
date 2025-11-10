import SwiftUI
import AppKit

struct MenuBarView: View {
    @StateObject private var viewModel = MenuBarViewModel()
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        // MARK: - Sync Actions
        Button {
            viewModel.syncAppleBooksNow()
        } label: {
            Label("Sync Apple Books", systemImage: "book")
        }
        
        Button {
            viewModel.syncGoodLinksNow()
        } label: {
            Label("Sync GoodLinks", systemImage: "link")
        }
        
        Divider()
        
        // MARK: - Auto Sync Toggle
        Toggle(isOn: Binding(
            get: { viewModel.autoSyncAppleBooks },
            set: { viewModel.setAutoSyncAppleBooks($0) }
        )) {
            Label("Auto Sync Apple Books", systemImage: "book.fill")
        }
        
        Toggle(isOn: Binding(
            get: { viewModel.autoSyncGoodLinks },
            set: { viewModel.setAutoSyncGoodLinks($0) }
        )) {
            Label("Auto Sync GoodLinks", systemImage: "link.circle.fill")
        }
        
        // MARK: - Sync Queue Status
        if viewModel.runningCount > 0 || viewModel.queuedCount > 0 || viewModel.failedCount > 0 {
            Divider()
            
            VStack(alignment: .leading, spacing: 4) {
                if viewModel.runningCount > 0 {
                    HStack {
                        Label("\(viewModel.runningCount) Running", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                if viewModel.queuedCount > 0 {
                    HStack {
                        Label("\(viewModel.queuedCount) Queued", systemImage: "clock")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                if viewModel.failedCount > 0 {
                    HStack {
                        Label("\(viewModel.failedCount) Failed", systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        
        Divider()
        
        // MARK: - Settings
        Button {
            openWindow(id: "setting")
        } label: {
            Label("Settings", systemImage: "gear")
        }
        
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

