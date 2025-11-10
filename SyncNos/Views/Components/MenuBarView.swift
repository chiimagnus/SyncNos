import SwiftUI
import AppKit

struct MenuBarView: View {
    var body: some View {
        // 这里写入同步功能
        // 1、同步Apple Books笔记
        // 2、同步goodlinks笔记
        // 3、自动同步功能
        // 4、下次自动同步的时间
        
        Divider()
        
        // Quit application
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

