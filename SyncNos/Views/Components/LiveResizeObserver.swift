import SwiftUI
import AppKit

// Track macOS window live-resize events and expose as a SwiftUI binding.
public struct LiveResizeObserver: NSViewRepresentable {
    @Binding var isResizing: Bool

    public init(isResizing: Binding<Bool>) {
        self._isResizing = isResizing
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(isResizing: $isResizing)
    }

    public func makeNSView(context: Context) -> NSView {
        let view = TrackingView()
        view.onStart = { context.coordinator.setResizing(true) }
        view.onEnd = { context.coordinator.setResizing(false) }
        return view
    }

    public func updateNSView(_ nsView: NSView, context: Context) {}

    final class TrackingView: NSView {
        var onStart: (() -> Void)?
        var onEnd: (() -> Void)?

        override func viewWillStartLiveResize() {
            onStart?()
        }

        override func viewDidEndLiveResize() {
            onEnd?()
        }
    }

    public final class Coordinator {
        var isResizing: Binding<Bool>
        init(isResizing: Binding<Bool>) { self.isResizing = isResizing }
        func setResizing(_ newValue: Bool) {
            let apply = {
                if self.isResizing.wrappedValue != newValue {
                    self.isResizing.wrappedValue = newValue
                }
            }
            if Thread.isMainThread {
                apply()
            } else {
                DispatchQueue.main.async { apply() }
            }
        }
    }
}
