import SwiftUI

/// 展示文章全文的内容卡片。支持在 live resize 期间通过 `overrideWidth` 冻结最大宽度，
/// 并通过 `measuredWidth` 绑定向上层上报当前可用宽度用于冻结策略。
struct ArticleContentCardView: View {
    let wordCount: Int
    let contentText: String
    let overrideWidth: CGFloat?
    @Binding var measuredWidth: CGFloat

    init(
        wordCount: Int,
        contentText: String,
        overrideWidth: CGFloat? = nil,
        measuredWidth: Binding<CGFloat>
    ) {
        self.wordCount = wordCount
        self.contentText = contentText
        self.overrideWidth = overrideWidth
        self._measuredWidth = measuredWidth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text.fill")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Text("文章全文")
                    .font(.headline)
                    .foregroundColor(.primary)
                Spacer()
                Text("\(wordCount) 字")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.bottom, 4)

            Text(contentText)
                .font(.body)
                .foregroundColor(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding()
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.06)))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
                )
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


