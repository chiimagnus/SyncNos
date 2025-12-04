import SwiftUI

/// 统一占位视图：空状态与多选占位合并，确保 SyncQueueView 视图身份稳定
struct SelectionPlaceholderView: View {
    let title: String
    let count: Int?
    let onSyncSelected: (() -> Void)?
    
    /// 过滤后的 item 数量
    let filteredCount: Int
    /// 全部 item 数量
    let totalCount: Int
    
    // MARK: - Dynamic Type Support
    @ScaledMetric(relativeTo: .largeTitle) private var logoSize: CGFloat = 120
    @ScaledMetric(relativeTo: .largeTitle) private var titleFontSize: CGFloat = 56

    init(
        title: String,
        count: Int? = nil,
        filteredCount: Int = 0,
        totalCount: Int = 0,
        onSyncSelected: (() -> Void)? = nil
    ) {
        self.title = title
        self.count = count
        self.filteredCount = filteredCount
        self.totalCount = totalCount
        self.onSyncSelected = onSyncSelected
    }

    private var isMultipleSelection: Bool { count ?? 0 > 0 && onSyncSelected != nil }

    private func colorForTitle(_ title: String) -> Color {
        switch title.lowercased() {
        case let t where t.contains("apple"): // #FE9509, 十六进制写法
            return Color(red: 0xFE / 255, green: 0x95 / 255, blue: 0x09 / 255)
        case let t where t.contains("goodlinks"): // #EA3558
            return Color(red: 0xEA / 255, green: 0x35 / 255, blue: 0x58 / 255)
        case let t where t.contains("weread"): // #30ACFE
            return Color(red: 0x30 / 255, green: 0xAC / 255, blue: 0xFE / 255)
        default:
            return .primary
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // App Logo - 使用 @ScaledMetric 支持 Dynamic Type
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .frame(width: logoSize, height: logoSize)

                // 标题 - 使用 @ScaledMetric 支持 Dynamic Type
                Text(title)
                    .font(.system(size: titleFontSize, weight: .bold, design: .rounded))
                    .fontWidth(.compressed)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundColor(colorForTitle(title))

                if isMultipleSelection, let count {
                    Button {
                        onSyncSelected?()
                    } label: {
                        Label("Sync Selected (\(count)) to Notion", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .font(.body) // 确保按钮文字支持 Dynamic Type
                    .padding(.bottom, 16)
                } else {
                    HStack(spacing: 12) {
                        Text("Please select an item")
                            .font(.title3) // 系统样式，自动支持 Dynamic Type
                            .foregroundColor(.secondary)
                        
                        // 显示过滤后/全部数量
                        if totalCount > 0 {
                            Text("\(filteredCount)/\(totalCount)")
                                .font(.title3.monospacedDigit()) // 系统样式
                                .foregroundColor(.secondary.opacity(0.7))
                        }
                    }
                    .padding(.bottom, 16)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Sync Queue")
                        .font(.title2) // 系统样式，自动支持 Dynamic Type
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

/// 时间戳信息结构
struct TimestampInfo {
    let addedAt: Date?
    let modifiedAt: Date?
    let lastSyncAt: Date?
    
    var hasAnyTimestamp: Bool {
        addedAt != nil || modifiedAt != nil || lastSyncAt != nil
    }
}

/// 全局日期格式化器（避免泛型类型中的静态属性问题）
private let infoHeaderDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateStyle = .short
    f.timeStyle = .short
    return f
}()

/// 通用的头部信息卡片，半透明背景，左右结构可扩展
struct InfoHeaderCardView<Content: View, Trailing: View>: View {
    let title: String
    let subtitle: String?
    let overrideWidth: CGFloat?
    let timestamps: TimestampInfo?
    let trailing: () -> Trailing
    let content: () -> Content

    init(
        title: String,
        subtitle: String? = nil,
        overrideWidth: CGFloat? = nil,
        timestamps: TimestampInfo? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.overrideWidth = overrideWidth
        self.timestamps = timestamps
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
            
            // 时间戳信息
            if let timestamps = timestamps, timestamps.hasAnyTimestamp {
                Divider()
                
                HStack(spacing: 16) {
                    if let addedAt = timestamps.addedAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Added Time")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: addedAt))
                                .font(.caption)
                        }
                    }
                    if let modifiedAt = timestamps.modifiedAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Modified Time")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: modifiedAt))
                                .font(.caption)
                        }
                    }
                    if let lastSyncAt = timestamps.lastSyncAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Last Sync Time")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: lastSyncAt))
                                .font(.caption)
                        }
                    }
                }
            }
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
