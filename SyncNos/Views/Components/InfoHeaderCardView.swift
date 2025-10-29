import SwiftUI

struct MultipleSelectionPlaceholderView: View {
    let title: String
    let count: Int
    let onSyncSelected: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(nsImage: NSImage(named: "AppIcon")!)
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 120)
            Text(title)
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .fontWidth(.compressed)
                .minimumScaleFactor(0.8)
            Text("Multiple Selected (\(count))")
                .font(.title3)
                .foregroundColor(.primary)
            Button {
                onSyncSelected()
            } label: {
                Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath")
            }
            
            // if ...
            Text("This area will show the sync queue progress and management buttons (coming soon!)")
        }
    }
}

import SwiftUI

/// 通用的头部信息卡片，半透明背景，左右结构可扩展
struct InfoHeaderCardView<Content: View, Trailing: View>: View {
    let title: String
    let subtitle: String?
    let overrideWidth: CGFloat?
    let trailing: () -> Trailing
    let content: () -> Content

    init(
        title: String,
        subtitle: String? = nil,
        overrideWidth: CGFloat? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.overrideWidth = overrideWidth
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
        .frame(maxWidth: overrideWidth, alignment: .leading)
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
