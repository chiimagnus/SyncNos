import SwiftUI

// MARK: - Search Focus Compatibility

extension View {
    /// 在 macOS 15+ 使用 `searchFocused`，旧系统安全降级
    @ViewBuilder
    func applySearchFocusIfAvailable(_ isFocused: FocusState<Bool>.Binding) -> some View {
        if #available(macOS 15.0, *) {
            self.searchFocused(isFocused)
        } else {
            self
        }
    }
}
