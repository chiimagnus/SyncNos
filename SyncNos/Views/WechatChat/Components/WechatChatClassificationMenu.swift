import SwiftUI
import AppKit

/// WechatChat 消息分类菜单（用于右键 contextMenu）。
///
/// 说明：
/// - 由于你已明确“不需要保留系统右键菜单”，这里直接使用 SwiftUI `contextMenu` 作为唯一入口。
/// - 选中文本仍可通过 `.textSelection(.enabled)` + `Cmd+C` 完成复制。
struct WechatChatClassificationMenu: View {
    let copyText: String?
    let isFromMe: Bool
    let kind: WechatMessageKind
    let onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

    var body: some View {
        if let copyText {
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(copyText, forType: .string)
            } label: {
                Label("复制", systemImage: "doc.on.doc")
            }

            Divider()
        }

        Button {
            onClassify(false, .text)
        } label: {
            menuLabel("对方消息", isActive: !isFromMe && kind != .system)
        }

        Button {
            onClassify(true, .text)
        } label: {
            menuLabel("我的消息", isActive: isFromMe && kind != .system)
        }

        Divider()

        Button {
            onClassify(false, .system)
        } label: {
            menuLabel("系统消息", isActive: kind == .system)
        }
    }

    @ViewBuilder
    private func menuLabel(_ title: String, isActive: Bool) -> some View {
        if isActive {
            Label(title, systemImage: "checkmark")
        } else {
            Text(title)
        }
    }
}


