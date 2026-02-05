import SwiftUI

// MARK: - Window Commands
struct WindowCommands: Commands {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @FocusedValue(\.isMainWindowSceneActive) private var isMainWindowSceneActive: Bool?
    @FocusedValue(\.isMainWindowStayOnTopEnabled) private var isMainWindowStayOnTopEnabled: Bool?

    private var stayOnTopBinding: Binding<Bool> {
        Binding(
            get: { isMainWindowStayOnTopEnabled ?? false },
            set: { enabled in
                NotificationCenter.default.post(
                    name: .mainWindowStayOnTopSetRequested,
                    object: nil,
                    userInfo: ["enabled": enabled]
                )
            }
        )
    }

    var body: some Commands {
        // 隐藏窗口列表（Settings、Logs、主窗口等不再显示在 Window 菜单）
        CommandGroup(replacing: .windowList) {}

        // MARK: - Text Size Commands
        CommandGroup(replacing: .singleWindowList) {
            Toggle("Stay on Top", isOn: stayOnTopBinding)
                .disabled(isMainWindowSceneActive != true)

            Divider()

            Button("Increase Text Size") {
                fontScaleManager.increaseSize()
            }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(!fontScaleManager.canIncreaseSize)

            Button("Decrease Text Size") {
                fontScaleManager.decreaseSize()
            }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!fontScaleManager.canDecreaseSize)

            Button("Reset Text Size") {
                fontScaleManager.reset()
            }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(fontScaleManager.isDefaultSize)
        }
    }
}
