import SwiftUI
import AppKit

/// 在 macOS 上支持“文本选择 + 系统右键菜单 + 自定义菜单项”的文本视图。
///
/// 目标交互（参考你给的截图）：
/// - 右键弹出系统文本菜单（Look Up / Translate / Copy / ...）
/// - 同时在菜单顶部插入我们自定义的“消息分类”项
struct WechatChatSelectableTextView: NSViewRepresentable {
    struct Style {
        let font: NSFont
        let textColor: NSColor
        let horizontalPadding: CGFloat
        let verticalPadding: CGFloat

        static func bubble() -> Style {
            Style(
                font: NSFont.systemFont(ofSize: NSFont.systemFontSize),
                textColor: .labelColor,
                horizontalPadding: 12,
                verticalPadding: 8
            )
        }

        static func system() -> Style {
            Style(
                font: NSFont.preferredFont(forTextStyle: .caption1),
                textColor: .secondaryLabelColor,
                horizontalPadding: 12,
                verticalPadding: 6
            )
        }
    }

    let text: String
    let isFromMe: Bool
    let kind: WechatMessageKind
    let style: Style
    let onSelect: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelect: onSelect, onClassify: onClassify)
    }

    func makeNSView(context: Context) -> MenuAwareTextView {
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer()
        layoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(layoutManager)

        let textView = MenuAwareTextView(frame: .zero, textContainer: textContainer)
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.minSize = .zero

        if let textContainer = textView.textContainer {
            textContainer.lineFragmentPadding = 0
            textContainer.lineBreakMode = .byWordWrapping
            textContainer.widthTracksTextView = false
            textContainer.heightTracksTextView = false
        }

        // 渲染与布局
        applyContent(to: textView, coordinator: context.coordinator)

        // 右键菜单弹出时触发选中
        textView.onMenuWillOpen = { [weak coordinator = context.coordinator] in
            coordinator?.onSelect()
        }

        // 左键点击时触发选中
        textView.onMouseDown = { [weak coordinator = context.coordinator] in
            coordinator?.onSelect()
        }

        // 自定义菜单项（分类）- 每次需要时都“新建 items”，避免 NSMenuItem 被重复插入导致崩溃
        textView.menuItemsProvider = { [weak coordinator = context.coordinator] in
            coordinator?.makeClassificationMenuItems() ?? []
        }

        return textView
    }

    func updateNSView(_ nsView: MenuAwareTextView, context: Context) {
        context.coordinator.isFromMe = isFromMe
        context.coordinator.kind = kind
        context.coordinator.onSelect = onSelect
        context.coordinator.onClassify = onClassify

        applyContent(to: nsView, coordinator: context.coordinator)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: MenuAwareTextView, context: Context) -> CGSize? {
        guard let textContainer = nsView.textContainer,
              let layoutManager = nsView.layoutManager else {
            return nil
        }

        // SwiftUI 可能传入无限宽度，这里做兜底，避免被错误拉伸
        let maxWidth: CGFloat = {
            guard let proposed = proposal.width,
                  proposed.isFinite,
                  proposed > 0 else {
                return 520
            }
            return proposed
        }()

        let horizontalPadding = style.horizontalPadding
        let verticalPadding = style.verticalPadding

        // 两段测量：
        // 1) 用一个很大的容器测出“单行理想宽度”
        // 2) 再按 maxWidth 折行测出实际高度（保证短文本不会被拉满整行）
        let unconstrainedWidth: CGFloat = 10_000
        textContainer.containerSize = CGSize(width: unconstrainedWidth, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)

        let idealGlyphRange = layoutManager.glyphRange(for: textContainer)
        let idealUsedWidth = maxLineFragmentUsedWidth(layoutManager: layoutManager, glyphRange: idealGlyphRange)
        let idealWidth = ceil(idealUsedWidth) + horizontalPadding * 2
        let targetWidth = min(idealWidth, maxWidth)

        let wrapContainerWidth = max(0, targetWidth - horizontalPadding * 2)
        textContainer.containerSize = CGSize(width: wrapContainerWidth, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)

        let wrappedUsed = layoutManager.usedRect(for: textContainer)
        let width = targetWidth
        let height = ceil(wrappedUsed.height) + verticalPadding * 2
        return CGSize(width: width, height: height)
    }

    private func maxLineFragmentUsedWidth(layoutManager: NSLayoutManager, glyphRange: NSRange) -> CGFloat {
        var maxWidth: CGFloat = 0
        layoutManager.enumerateLineFragments(forGlyphRange: glyphRange) { _, usedRect, _, _, _ in
            maxWidth = max(maxWidth, usedRect.width)
        }
        return maxWidth
    }

    private func applyContent(to textView: MenuAwareTextView, coordinator: Coordinator) {
        if textView.string != text {
            textView.string = text
        }
        textView.font = style.font
        textView.textColor = style.textColor
        textView.textContainerInset = NSSize(width: style.horizontalPadding, height: style.verticalPadding)

        coordinator.isFromMe = isFromMe
        coordinator.kind = kind
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject {
        var isFromMe: Bool = false
        var kind: WechatMessageKind = .text
        var onSelect: () -> Void
        var onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

        init(onSelect: @escaping () -> Void, onClassify: @escaping (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void) {
            self.onSelect = onSelect
            self.onClassify = onClassify
        }

        func makeClassificationMenuItems() -> [NSMenuItem] {
            let otherItem = NSMenuItem(title: "对方消息", action: #selector(classifyOther), keyEquivalent: "")
            otherItem.target = self
            otherItem.state = (!isFromMe && kind != .system) ? .on : .off

            let meItem = NSMenuItem(title: "我的消息", action: #selector(classifyMe), keyEquivalent: "")
            meItem.target = self
            meItem.state = (isFromMe && kind != .system) ? .on : .off

            let systemItem = NSMenuItem(title: "系统消息", action: #selector(classifySystem), keyEquivalent: "")
            systemItem.target = self
            systemItem.state = (kind == .system) ? .on : .off

            return [
                otherItem,
                meItem,
                .separator(),
                systemItem
            ]
        }

        @objc private func classifyOther() { onClassify(false, .text) }
        @objc private func classifyMe() { onClassify(true, .text) }
        @objc private func classifySystem() { onClassify(false, .system) }
    }

    // MARK: - NSTextView subclass

    final class MenuAwareTextView: NSTextView {
        var menuItemsProvider: (() -> [NSMenuItem])?
        var onMouseDown: (() -> Void)?
        var onMenuWillOpen: (() -> Void)?

        override func mouseDown(with event: NSEvent) {
            onMouseDown?()
            super.mouseDown(with: event)
        }

        override func menu(for event: NSEvent) -> NSMenu? {
            onMenuWillOpen?()

            // 先拿系统菜单（包含 Look Up / Translate / Copy / Services / ...）
            // 注意：不要直接 mutate 系统菜单本体（有子菜单时容易触发内部一致性断言）
            // 这里复制一份再插入我们的自定义项。
            let systemMenu = super.menu(for: event)
            let baseMenu = (systemMenu?.copy() as? NSMenu) ?? NSMenu()

            // 再把我们自定义的分类菜单插到顶部（items 必须是“全新对象”，不能来自其它 menu）
            let customItems = menuItemsProvider?() ?? []
            if !customItems.isEmpty {
                for (idx, item) in customItems.enumerated() {
                    baseMenu.insertItem(item, at: idx)
                }
                // 分隔自定义项与系统项（避免粘连）
                if baseMenu.items.count > customItems.count {
                    baseMenu.insertItem(.separator(), at: customItems.count)
                }
            }

            return baseMenu
        }
    }
}


