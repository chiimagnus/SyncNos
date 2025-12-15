import SwiftUI
import AppKit

/// 读取 SwiftUI 视图所在的 `NSWindow`。
///
/// - Note: 通过 `NSViewRepresentable` 把 window 注入到 SwiftUI state，适用于需要基于窗口过滤 NSEvent 的场景。
struct WindowReader: NSViewRepresentable {
    @Binding var window: NSWindow?
    
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            self.window = view.window
        }
        return view
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if self.window !== nsView.window {
                self.window = nsView.window
            }
        }
    }
}

