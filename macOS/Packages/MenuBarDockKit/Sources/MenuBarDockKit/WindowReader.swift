import AppKit
import SwiftUI

/// 读取 SwiftUI 视图所在的 `NSWindow`。
///
/// - Note: 通过 `NSViewRepresentable` 把 window 注入到 SwiftUI state。
public struct WindowReader: NSViewRepresentable {
    @Binding public var window: NSWindow?
    public var onWindowChanged: ((NSWindow?) -> Void)? = nil

    public init(window: Binding<NSWindow?>, onWindowChanged: ((NSWindow?) -> Void)? = nil) {
        self._window = window
        self.onWindowChanged = onWindowChanged
    }

    public func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            let newWindow = view.window
            self.window = newWindow
            onWindowChanged?(newWindow)
        }
        return view
    }

    public func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if self.window !== nsView.window {
                let newWindow = nsView.window
                self.window = newWindow
                onWindowChanged?(newWindow)
            }
        }
    }
}

