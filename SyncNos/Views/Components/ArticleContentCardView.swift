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
    let resetId: String?

    @State private var isExpanded: Bool = false

    init(
        wordCount: Int,
        contentText: String,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        revealThreshold: Int? = 800,
        resetId: String? = nil
    ) {
        self.wordCount = wordCount
        self.contentText = contentText
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.revealThreshold = revealThreshold
        self.customSlot = nil
        self.resetId = resetId
    }

    init(
        wordCount: Int,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        revealThreshold: Int? = 800,
        customSlot: AnyView,
        resetId: String? = nil
    ) {
        self.wordCount = wordCount
        self.contentText = ""
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.revealThreshold = revealThreshold
        self.customSlot = customSlot
        self.resetId = resetId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text.fill")
                    .font(.headline)
                    .foregroundColor(.secondary)
                
                Text("Article")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Text("\(wordCount) words")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
            }
            .padding(.bottom, 4)

            Group {
                if let slot = customSlot {
                    slot
                        .font(.body)
                        .foregroundColor(.primary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(contentText)
                        .font(.body)
                        .foregroundColor(.primary)
                        .textSelection(.disabled)
                        .lineLimit(isExpanded ? nil : collapsedLineLimit)
                        .fixedSize(horizontal: false, vertical: isExpanded)
                }
            }
            .padding()
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
            )

            if shouldShowToggle {
                Button(action: { isExpanded.toggle() }) {
                    HStack(spacing: 6) {
                        Text(isExpanded ? "Collapse" : "Expand")
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .imageScale(.small)
                    }
                    .font(.caption)
                }
                .buttonStyle(.link)
            }
        }
        .onChange(of: resetId) { _ in
            isExpanded = false
        }
        .overlay(
            GeometryReader { proxy in
                let w = proxy.size.width
                Color.clear
                    .onAppear { measuredWidth = w }
                    .onChange(of: w) { newValue in
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


