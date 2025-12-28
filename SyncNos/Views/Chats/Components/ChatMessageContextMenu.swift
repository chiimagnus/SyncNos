import SwiftUI
import AppKit

/// Chat 消息右键菜单（SwiftUI 版本）
///
/// 目标：
/// - 禁用系统"文本选择"右键菜单（不使用 `.textSelection(.enabled)`）
/// - 用 SwiftUI `.contextMenu` 提供我们自己的菜单
/// - 尽量补齐系统菜单常用能力（复制/分享）
struct ChatMessageContextMenu: View {
    let text: String
    let isFromMe: Bool
    let kind: ChatMessageKind
    let senderName: String?
    let onSelect: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void

    var body: some View {
        // 分类（业务菜单）
        Button {
            onSelect()
            onClassify(false, .text)
        } label: {
            classifyLabel("对方消息", isActive: !isFromMe && kind != .system)
        }

        Button {
            onSelect()
            onClassify(true, .text)
        } label: {
            classifyLabel("我的消息", isActive: isFromMe && kind != .system)
        }

        Button {
            onSelect()
            onClassify(false, .system)
        } label: {
            classifyLabel("系统消息", isActive: kind == .system)
        }

        Divider()

        // 昵称设置（仅对非系统消息显示）
        if kind != .system {
            Button {
                onSelect()
                onSetSenderName()
            } label: {
                if let name = senderName, !name.isEmpty {
                    Label("Change Sender Name (\(name))...", systemImage: "person.text.rectangle")
                } else {
                    Label("Set Sender Name...", systemImage: "person.text.rectangle")
                }
            }

            if let name = senderName, !name.isEmpty {
                Button(role: .destructive) {
                    onSelect()
                    onClearSenderName()
                } label: {
                    Label("Clear Sender Name", systemImage: "person.badge.minus")
                }
            }

            Divider()
        }

        Button {
            onSelect()
            copyToPasteboard(text)
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }

        ShareLink(item: text) {
            Label("Share…", systemImage: "square.and.arrow.up")
        }
    }

    @ViewBuilder
    private func classifyLabel(_ title: String, isActive: Bool) -> some View {
        if isActive {
            Label(title, systemImage: "checkmark")
        } else {
            Text(title)
        }
    }

    private func copyToPasteboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

