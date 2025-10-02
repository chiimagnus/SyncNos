import SwiftUI

/// 通用的头部信息卡片，半透明背景，左右结构可扩展
struct InfoHeaderCardView<Content: View, Trailing: View>: View {
    let title: String
    let subtitle: String?
    let trailing: () -> Trailing
    let content: () -> Content

    init(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.title)
                        .fontWeight(.bold)
                        .textSelection(.enabled)
                    if let subtitle = subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.title3)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer(minLength: 0)
                trailing()
            }

            content()
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.gray.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
        )
    }
}


