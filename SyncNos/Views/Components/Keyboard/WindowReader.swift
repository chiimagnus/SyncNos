import SwiftUI

/// 读取 SwiftUI 视图所在的 `NSWindow`。
///
/// - Note: 通过 `NSViewRepresentable` 把 window 注入到 SwiftUI state，适用于需要基于窗口过滤 NSEvent 的场景。
struct WindowReader: NSViewRepresentable {
    @Binding var window: NSWindow?
    var onWindowChanged: ((NSWindow?) -> Void)? = nil
    
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            let newWindow = view.window
            self.window = newWindow
            onWindowChanged?(newWindow)
        }
        return view
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if self.window !== nsView.window {
                let newWindow = nsView.window
                self.window = newWindow
                onWindowChanged?(newWindow)
            }
        }
    }
}
