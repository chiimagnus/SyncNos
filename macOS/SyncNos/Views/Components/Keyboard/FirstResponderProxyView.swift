import SwiftUI
import AppKit

/// 提供一个「一定能成为 firstResponder」的透明 NSView，用于把焦点从 List 可靠切到 Detail。
///
/// 背景：SwiftUI 的 `ScrollView` / `List` 在某些情况下点击后不会自动让 Detail 侧产生 firstResponder，
/// 导致左侧 List 的选中高亮始终保持强调色。此 view 作为稳定的 firstResponder “落点”，
/// 让我们可以在不依赖 ScrollView 内部实现细节的情况下完成焦点切换。
struct FirstResponderProxyView: NSViewRepresentable {
    @Binding var view: NSView?
    
    func makeNSView(context: Context) -> NSView {
        let nsView = ProxyNSView()
        DispatchQueue.main.async {
            self.view = nsView
        }
        return nsView
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if self.view !== nsView {
                self.view = nsView
            }
        }
    }
    
    final class ProxyNSView: NSView {
        override var acceptsFirstResponder: Bool { true }
    }
}


