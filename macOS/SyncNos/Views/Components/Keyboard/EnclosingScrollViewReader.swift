import SwiftUI

/// 在 `ScrollView` 内容内部使用，用于拿到其底层 `NSScrollView`（enclosingScrollView）。
///
/// 典型用法：放在 `ScrollView` 的内容里（例如顶部 `Color.clear` 的 background），即可回调当前的 `NSScrollView`。
struct EnclosingScrollViewReader: NSViewRepresentable {
    var onResolve: (NSScrollView) -> Void
    
    final class Coordinator {
        weak var lastScrollView: NSScrollView?
    }
    
    func makeCoordinator() -> Coordinator { Coordinator() }
    
    func makeNSView(context: Context) -> NSView {
        NSView()
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        // 需要等视图挂到层级后 enclosingScrollView 才稳定
        DispatchQueue.main.async {
            guard let scrollView = nsView.enclosingScrollView else { return }
            if context.coordinator.lastScrollView !== scrollView {
                context.coordinator.lastScrollView = scrollView
                onResolve(scrollView)
            }
        }
    }
}

