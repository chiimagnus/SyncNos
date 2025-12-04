import SwiftUI

/// 展示文章全文的内容卡片。支持在 live resize 期间通过 `overrideWidth` 冻结最大宽度，
/// 并通过 `measuredWidth` 绑定向上层上报当前可用宽度用于冻结策略。
struct ArticleContentCardView: View {
    let wordCount: Int
    let contentText: String
    let overrideWidth: CGFloat?
    @Binding var measuredWidth: CGFloat
    let collapsedLineLimit: Int
    let revealThreshold: Int?
    let customSlot: AnyView?
    // Optional binding provided by parent to control expanded state.
    let isExpandedBinding: Binding<Bool>?

    @State private var isExpandedInternal: Bool = false

    private var expandedBinding: Binding<Bool> {
        if let b = isExpandedBinding { return b }
        return Binding(get: { self.isExpandedInternal }, set: { self.isExpandedInternal = $0 })
    }

    init(
        wordCount: Int,
        contentText: String,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        revealThreshold: Int? = 800,
        isExpanded: Binding<Bool>? = nil
    ) {
        self.wordCount = wordCount
        self.contentText = contentText
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.revealThreshold = revealThreshold
        self.customSlot = nil
        self.isExpandedBinding = isExpanded
    }

    init(
        wordCount: Int,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        revealThreshold: Int? = 800,
        customSlot: AnyView,
        isExpanded: Binding<Bool>? = nil
    ) {
        self.wordCount = wordCount
        self.contentText = ""
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.revealThreshold = revealThreshold
        self.customSlot = customSlot
        self.isExpandedBinding = isExpanded
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text.fill")
                    .scaledFont(.headline)
                    .foregroundColor(.secondary)
                
                Text("Article")
                    .scaledFont(.headline)
                    .foregroundColor(.primary)
                
                Text("\(wordCount) words")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
            }
            .padding(.bottom, 4)

            Group {
                if let slot = customSlot {
                    slot
                        .scaledFont(.body)
                        .foregroundColor(.primary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(contentText)
                        .scaledFont(.body)
                        .foregroundColor(.primary)
                        .textSelection(.disabled)
                        .lineLimit(expandedBinding.wrappedValue ? nil : collapsedLineLimit)
                        .fixedSize(horizontal: false, vertical: expandedBinding.wrappedValue)
                }
            }
            .padding()
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
            )

            if shouldShowToggle {
                Button(action: { expandedBinding.wrappedValue.toggle() }) {
                    HStack(spacing: 6) {
                        Text(expandedBinding.wrappedValue ? "Collapse" : "Expand")
                        Image(systemName: expandedBinding.wrappedValue ? "chevron.up" : "chevron.down")
                            .imageScale(.small)
                    }
                    .scaledFont(.caption)
                }
                .buttonStyle(.link)
            }
        }
        .overlay(
            GeometryReader { proxy in
                let w = proxy.size.width
                Color.clear
                    .onAppear { measuredWidth = w }
                    .onChange(of: w) { _, newValue in
                        measuredWidth = newValue
                    }
            }
        )
        .frame(maxWidth: overrideWidth, alignment: .leading)
    }
}

private extension ArticleContentCardView {
    var shouldShowToggle: Bool {
        if customSlot != nil { return false }
        if let threshold = revealThreshold {
            return contentText.count > threshold
        }
        return true
    }
}
