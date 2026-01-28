import SwiftUI

// MARK: - Edit Commands
struct EditCommands: Commands {
    @FocusedValue(\.selectionCommands) private var selectionCommands: SelectionCommands?
    @FocusedValue(\.isMainWindowSceneActive) private var isMainWindowSceneActive: Bool?
    @FocusedValue(\.isGlobalSearchPresented) private var isGlobalSearchPresented: Bool?

    var body: some Commands {
        // Edit 菜单 - 编辑操作相关
        // 替换剪贴板命令组，但显式添加 Copy/Cut/Paste 以保留文本字段的快捷键功能
        CommandGroup(replacing: .pasteboard) {
            // 保留系统默认的 Copy 命令（用于文本字段）
            Button("Copy", systemImage: "doc.on.doc") {
                NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("c", modifiers: .command)

            // 保留系统默认的 Cut 命令（用于文本字段）
            Button("Cut", systemImage: "scissors") {
                NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("x", modifiers: .command)

            // 保留系统默认的 Paste 命令（用于文本字段）
            Button("Paste", systemImage: "doc.on.clipboard") {
                NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil)
            }
            .keyboardShortcut("v", modifiers: .command)

            Divider()

            // 自定义的 Select All（优先尝试系统文本全选，失败时回退到列表选择）
            Button("Select All", systemImage: "character.textbox") {
                // 只在用户正在输入文本时才走系统文本全选。
                // 注意：如果先无差别调用 sendAction(selectAll:)，List 的底层 NSOutlineView/NSTableView 可能会拦截并“只全选已渲染的 80 条”（分页子集），
                // 从而导致我们的逻辑全选（display* 全量 - 排除）根本不会执行。
                if let window = NSApp.keyWindow, window.firstResponder is NSTextView {
                    NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
                } else {
                    selectionCommands?.selectAll()
                }
            }
            .keyboardShortcut("a", modifiers: [.command])

            // 自定义的 Deselect（用于列表视图）
            Button("Deselect", systemImage: "character.textbox.badge.sparkles") {
                selectionCommands?.deselectAll()
            }
            .keyboardShortcut(.escape)
            .disabled(!(selectionCommands?.canDeselect() ?? false))
        }

        // 全局搜索（⌘K）：Notion 风格弹出面板
        CommandGroup(after: .pasteboard) {
            Button("全局搜索", systemImage: "magnifyingglass") {
                NotificationCenter.default.post(name: .globalSearchPanelToggleRequested, object: nil)
            }
            .keyboardShortcut("k", modifiers: .command)
            // 仅在主窗口激活时可用，避免在 Settings/Logs 窗口触发并影响主窗口
            .disabled(!(isMainWindowSceneActive ?? false))

            Button("在详情中查找", systemImage: "text.magnifyingglass") {
                NotificationCenter.default.post(name: .detailSearchFocusRequested, object: nil)
            }
            .keyboardShortcut("f", modifiers: .command)
            // 仅在主窗口激活时可用；全局搜索面板打开时避免抢焦点
            .disabled(!(isMainWindowSceneActive ?? false) || (isGlobalSearchPresented ?? false))
        }
    }
}
