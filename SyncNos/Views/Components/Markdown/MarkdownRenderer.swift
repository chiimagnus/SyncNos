import SwiftUI
import Markdown

/// 基于 swift-markdown AST 的 SwiftUI 渲染器
/// - 保证文本层透明；卡片背景由外层视图控制
struct MarkdownRendererView: View {
    let originalText: String
    let document: Document
    var theme: MarkdownRenderTheme = .init()

    init(originalText: String, theme: MarkdownRenderTheme = .init()) {
        self.originalText = originalText
        self.theme = theme
        self.document = MarkdownParser.parse(originalText)
    }

    var body: some View {
        let renderedBlocks: [AnyView] = renderBlocks(blocks)
        return VStack(alignment: .leading, spacing: theme.blockSpacing) {
            ForEach(0..<renderedBlocks.count, id: \.self) { i in
                renderedBlocks[i]
            }
        }
        .background(Color.clear)
    }

    // MARK: - Block Rendering

    private var blocks: [Markdown.Markup] {
        var result: [Markdown.Markup] = []
        for child in document.children { result.append(child) }
        return result
    }

    private var blocksIndices: [Int] { Array(blocks.indices) }

    private func renderBlocks(_ nodes: [Markdown.Markup]) -> [AnyView] {
        nodes.map { renderBlock($0) }
    }

    private func renderBlock(_ block: Markdown.Markup) -> AnyView {
        if let heading = block as? Markdown.Heading {
            let text = inlineText(from: heading)
            return AnyView(
                text
                .font(theme.fontForHeading(level: heading.level))
                .foregroundColor(theme.textPrimary)
                .padding(.bottom, theme.headingBottomSpacing)
                .background(Color.clear)
            )
        } else if let para = block as? Markdown.Paragraph {
            let text = inlineText(from: para)
            return AnyView(
                text
                .font(theme.fontBody)
                .foregroundColor(theme.textPrimary)
                .background(Color.clear)
            )
        } else if let quote = block as? Markdown.BlockQuote {
            let childViews = renderBlocks(children(of: quote))
            return AnyView(
                HStack(alignment: .top, spacing: 8) {
                    Rectangle()
                        .fill(theme.quoteLineColor)
                        .frame(width: 3)
                    VStack(alignment: .leading, spacing: theme.paragraphSpacing) {
                        ForEach(0..<childViews.count, id: \.self) { idx in
                            childViews[idx]
                        }
                    }
                }
                .background(Color.clear)
            )
        } else if let ulist = block as? Markdown.UnorderedList {
            let items = listItems(from: ulist)
            return AnyView(
                VStack(alignment: .leading, spacing: theme.listRowSpacing) {
                    ForEach(0..<items.count, id: \.self) { i in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            SwiftUI.Text("•")
                                .foregroundColor(theme.textSecondary)
                            let childViews = renderBlocks(children(of: items[i]))
                            VStack(alignment: .leading, spacing: theme.paragraphSpacing) {
                                ForEach(0..<childViews.count, id: \.self) { idx in
                                    childViews[idx]
                                }
                            }
                        }
                    }
                }
                .background(Color.clear)
            )
        } else if let olist = block as? Markdown.OrderedList {
            let items = listItems(from: olist)
            return AnyView(
                VStack(alignment: .leading, spacing: theme.listRowSpacing) {
                    ForEach(0..<items.count, id: \.self) { i in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            SwiftUI.Text("\(i + 1).")
                                .foregroundColor(theme.textSecondary)
                            let childViews = renderBlocks(children(of: items[i]))
                            VStack(alignment: .leading, spacing: theme.paragraphSpacing) {
                                ForEach(0..<childViews.count, id: \.self) { idx in
                                    childViews[idx]
                                }
                            }
                        }
                    }
                }
                .background(Color.clear)
            )
        } else if let code = block as? Markdown.CodeBlock {
            return AnyView(
                ScrollView(.horizontal, showsIndicators: false) {
                    SwiftUI.Text(code.code)
                        .font(theme.fontMonospaced)
                        .textSelection(.enabled)
                        .padding(theme.codeBlockPadding)
                        .background(Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(theme.codeBorderColor, lineWidth: 1)
                        )
                }
                .background(Color.clear)
            )
        } else if block is Markdown.ThematicBreak {
            return AnyView(Divider().opacity(0.5).background(Color.clear))
        } else {
            // 兜底：将未知块按纯文本渲染
            let text = inlineText(from: block)
            return AnyView(
                text
                    .font(theme.fontBody)
                    .foregroundColor(theme.textPrimary)
                    .background(Color.clear)
            )
        }
    }

    private func renderListItem(_ item: Markdown.ListItem) -> AnyView {
        let childViews = renderBlocks(children(of: item))
        return AnyView(
            VStack(alignment: .leading, spacing: theme.paragraphSpacing) {
                ForEach(0..<childViews.count, id: \.self) { idx in
                    childViews[idx]
                }
            }
        )
    }

    private func children(of node: Markdown.Markup) -> [Markdown.Markup] {
        var result: [Markdown.Markup] = []
        for child in node.children { result.append(child) }
        return result
    }

    private func childrenIndices(of node: Markdown.Markup) -> [Int] { Array(children(of: node).indices) }

    private func listItems(from list: Markdown.Markup) -> [Markdown.ListItem] {
        children(of: list).compactMap { $0 as? Markdown.ListItem }
    }

    // MARK: - Inline Rendering

    private func inlineText(from node: Markdown.Markup) -> SwiftUI.Text {
        var result = SwiftUI.Text("")
        for child in node.children {
            result = result + inlineSegment(from: child)
        }
        return result
    }

    private func inlineSegment(from node: Markdown.Markup) -> SwiftUI.Text {
        if let t = node as? Markdown.Text {
            return SwiftUI.Text(t.string)
        } else if let em = node as? Markdown.Emphasis {
            return inlineText(from: em).italic()
        } else if let strong = node as? Markdown.Strong {
            return inlineText(from: strong).bold()
        } else if let del = node as? Markdown.Strikethrough {
            return inlineText(from: del).strikethrough(true)
        } else if let code = node as? Markdown.InlineCode {
            return SwiftUI.Text(code.code).font(theme.fontMonospaced)
        } else if let link = node as? Markdown.Link {
            var label = inlineText(from: link)
                .foregroundColor(theme.linkColor)
                .underline()
            // 纯 Text 无法直接附加点击事件；如需点击打开可改为 Button + action 渲染器
            return label
        } else if node is Markdown.SoftBreak {
            return SwiftUI.Text("\n")
        } else if node is Markdown.LineBreak {
            return SwiftUI.Text("\n")
        } else {
            // 递归处理未知内联节点
            return inlineText(from: node)
        }
    }
}

