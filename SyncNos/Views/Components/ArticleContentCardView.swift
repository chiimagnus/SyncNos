import SwiftUI

/// 展示文章全文的内容卡片。支持在 live resize 期间通过 `overrideWidth` 冻结最大宽度，
/// 并通过 `measuredWidth` 绑定向上层上报当前可用宽度用于冻结策略。
struct ArticleContentCardView: View {
    let wordCount: Int
    let contentText: String
    let blocks: [ArticleBlock]?
    let overrideWidth: CGFloat?
    @Binding var measuredWidth: CGFloat
    let collapsedLineLimit: Int
    let revealThreshold: Int?

    @State private var isExpanded: Bool = false

    init(
        wordCount: Int,
        contentText: String,
        blocks: [ArticleBlock]? = nil,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>,
        collapsedLineLimit: Int = 12,
        revealThreshold: Int? = 800
    ) {
        self.wordCount = wordCount
        self.contentText = contentText
        self.blocks = blocks
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
        self.collapsedLineLimit = collapsedLineLimit
        self.revealThreshold = revealThreshold
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
                if let blocks, !blocks.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                            switch b {
                            case .paragraph(let text):
                                Text(text)
                                    .font(.body)
                                    .foregroundColor(.primary)
                                    .textSelection(.enabled)
                            case .image(let url):
                                VStack(alignment: .leading, spacing: 6) {
                                    AsyncImage(url: url) { phase in
                                        switch phase {
                                        case .empty:
                                            ProgressView().frame(maxWidth: .infinity, alignment: .leading)
                                        case .success(let image):
                                            image
                                                .resizable()
                                                .scaledToFit()
                                                .frame(maxWidth: measuredWidth - 24)
                                        case .failure:
                                            // 显示 URL 文本作为回退
                                            Text(url.absoluteString)
                                                .font(.footnote)
                                                .foregroundColor(.blue)
                                                .textSelection(.enabled)
                                        @unknown default:
                                            Text(url.absoluteString)
                                                .font(.footnote)
                                                .foregroundColor(.blue)
                                                .textSelection(.enabled)
                                        }
                                    }
                                    // 在图片下方显示可复制的 URL
                                    Text(url.absoluteString)
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                    .lineLimit(isExpanded ? nil : collapsedLineLimit)
                    .fixedSize(horizontal: false, vertical: isExpanded)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
                    )
                } else {
                    Text(contentText)
                        .font(.body)
                        .foregroundColor(.primary)
                        .textSelection(.enabled)
                        .lineLimit(isExpanded ? nil : collapsedLineLimit)
                        .fixedSize(horizontal: false, vertical: isExpanded)
                        .padding()
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
                        )
                }
            }

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
        if let threshold = revealThreshold {
            return contentText.count > threshold
        }
        return true
    }
}


