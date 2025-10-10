import SwiftUI

struct ResizeFreezeModifier: ViewModifier {
    @Binding var isResizing: Bool
    @Binding var measuredWidth: CGFloat
    @Binding var frozenWidth: CGFloat?

    func body(content: Content) -> some View {
        content
            .background(LiveResizeObserver(isResizing: $isResizing))
            .onChange(of: isResizing) { resizing in
                if resizing {
                    frozenWidth = measuredWidth
                } else {
                    frozenWidth = nil
                }
            }
    }
}

extension View {
    func resizeFreeze(
        isResizing: Binding<Bool>,
        measuredWidth: Binding<CGFloat>,
        frozenWidth: Binding<CGFloat?>
    ) -> some View {
        modifier(ResizeFreezeModifier(isResizing: isResizing, measuredWidth: measuredWidth, frozenWidth: frozenWidth))
    }
}


