import SwiftUI
import AppKit

/// 菜单栏视图组件，提供快速访问应用功能的菜单项
struct MenuBarView: View {
    @Environment(\.openWindow) private var openWindow
    
    var body: some View {
        // 打开主窗口
        Button {
            openMainWindow()
        } label: {
            HStack {
                Label("Open Main Window", systemImage: "square.on.square")
                Spacer()
                Text("⌘O")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
            }
        }
        .keyboardShortcut("o", modifiers: .command)
        
        Divider()
        
        // 设置
        Button {
            openWindow(id: "setting")
        } label: {
            HStack {
                Label("Settings", systemImage: "gear")
                Spacer()
                Text("⌘,")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
            }
        }
        .keyboardShortcut(",", modifiers: .command)
        
        // 用户指南
        Button {
            openWindow(id: "userguide")
        } label: {
            Label("User Guide", systemImage: "questionmark.circle")
        }
        
        // 日志
        Button {
            openWindow(id: "log")
        } label: {
            HStack {
                Label("Show Logs", systemImage: "doc.text.magnifyingglass")
                Spacer()
                Text("⌘L")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
            }
        }
        .keyboardShortcut("l", modifiers: .command)
        
        Divider()
        
        // 退出
        Button {
            quitApplication()
        } label: {
            HStack {
                Label("Quit SyncNos", systemImage: "power")
                Spacer()
                Text("⌘Q")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
            }
        }
        .keyboardShortcut("q", modifiers: .command)
    }
    
    // MARK: - Actions
    
    /// 打开主窗口
    private func openMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        
        // 查找主窗口并激活
        if let mainWindow = NSApp.windows.first(where: { $0.isMainWindow || $0.isKeyWindow }) {
            mainWindow.makeKeyAndOrderFront(nil)
        } else {
            // 如果没有找到窗口，尝试打开新窗口
            // WindowGroup 会自动创建新窗口
            NSApp.activate(ignoringOtherApps: true)
        }
    }
    
    /// 退出应用
    /// 发送通知以绕过退出确认（如果用户明确点击退出），然后触发退出流程
    private func quitApplication() {
        // 发送通知，让 AppDelegate 知道这是用户主动退出
        // 如果正在同步，AppDelegate 会显示确认对话框
        // 如果没有同步，会直接退出
        NotificationCenter.default.post(name: Notification.Name("BypassQuitConfirmationOnce"), object: nil)
        NSApp.terminate(nil)
    }
}

