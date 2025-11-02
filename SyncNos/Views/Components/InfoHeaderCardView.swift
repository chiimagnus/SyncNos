import SwiftUI

/// 统一占位视图：空状态与多选占位合并，确保 SyncQueueView 视图身份稳定
struct SelectionPlaceholderView: View {
    let title: String
    let count: Int?
    let onSyncSelected: (() -> Void)?

    init(title: String, count: Int? = nil, onSyncSelected: (() -> Void)? = nil) {
        self.title = title
        self.count = count
        self.onSyncSelected = onSyncSelected
    }

    private var isMultipleSelection: Bool { count ?? 0 > 0 && onSyncSelected != nil }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // App Logo
                Image(nsImage: NSImage(named: "AppIcon")!)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 120, height: 120)

                Text(title)
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .fontWidth(.compressed)
                    .minimumScaleFactor(0.8)

                if isMultipleSelection, let count {
                    Button {
                        onSyncSelected?()
                    } label: {
                        Label("Sync Selected (\(count)) to Notion", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .padding(.bottom, 16)
                } else {
                    Text("Please select an item")
                        .font(.title3)
                        .foregroundColor(.secondary)
                        .padding(.bottom, 16)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Sync Queue")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // 关键：无论空态或多选，均保留同一位置的 SyncQueueView，避免重新订阅
                    SyncQueueView()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
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
