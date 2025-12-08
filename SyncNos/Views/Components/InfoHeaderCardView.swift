import SwiftUI
import Combine

/// 会话级的 Sync Queue 折叠状态（随应用重启重置）
/// 当有任务入队时自动展开
private final class SyncQueueCollapseStore: ObservableObject {
    static let shared = SyncQueueCollapseStore()
    @Published var isCollapsed: Bool = true
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        // 监听任务入队通知，自动展开
        NotificationCenter.default.publisher(for: Notification.Name("SyncTasksEnqueued"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, self.isCollapsed else { return }
                withAnimation(.easeInOut(duration: 0.18)) {
                    self.isCollapsed = false
                }
            }
            .store(in: &cancellables)
    }
}

/// 统一占位视图：空状态与多选占位合并，确保 SyncQueueView 视图身份稳定
struct SelectionPlaceholderView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @StateObject private var syncQueueCollapseStore = SyncQueueCollapseStore.shared
    
    let title: String
    let count: Int?
    let onSyncSelected: (() -> Void)?
    
    /// 过滤后的 item 数量
    let filteredCount: Int
    /// 全部 item 数量
    let totalCount: Int

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
        case let t where t.contains("apple"): // LogoColor - Apple Books
            return Color("BrandAppleBooks")
        case let t where t.contains("goodlinks"): // LogoColor - GoodLinks
            return Color("BrandGoodLinks")
        case let t where t.contains("weread"): // LogoColor - WeRead
            return Color("BrandWeRead")
        case let t where t.contains("dedao"): // LogoColor - Dedao
            return Color("BrandDedao")
        default:
            return .primary
        }
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    // App Logo - 使用 fontScaleManager 进行缩放
                    let logoSize: CGFloat = 120 * fontScaleManager.scaleFactor
                    Image("HeaderCard")
                        .resizable()
                        .scaledToFit()
                        .frame(width: logoSize, height: logoSize)

                    // 标题 - 使用 fontScaleManager 进行缩放
                    let titleFontSize: CGFloat = 56 * fontScaleManager.scaleFactor
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
                        .scaledFont(.body)
                        .padding(.bottom, 16)
                    } else {
                        HStack(spacing: 12) {
                            Text("Please select an item")
                                .scaledFont(.title3)
                                .foregroundColor(.secondary)
                            
                            // 显示过滤后/全部数量
                            if totalCount > 0 {
                                Text("\(filteredCount)/\(totalCount)")
                                    .scaledFont(.title3)
                                    .monospacedDigit()
                                    .foregroundColor(.secondary.opacity(0.7))
                            }
                        }
                        .padding(.bottom, 16)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Button {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                syncQueueCollapseStore.isCollapsed.toggle()
                            }
                        } label: {
                            HStack {
                                Image(systemName: syncQueueCollapseStore.isCollapsed ? "chevron.right" : "chevron.down")
                                    .foregroundStyle(.secondary)
                                Text("Sync Queue")
                                    .scaledFont(.title2, weight: .semibold)
                                    .foregroundStyle(.primary)
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        // 关键：无论空态或多选，均保留同一位置的 SyncQueueView，避免重新订阅
                        if !syncQueueCollapseStore.isCollapsed {
                            SyncQueueView()
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .center)
                .padding()
            }
        }
    }
}

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
                        .scaledFont(.title, weight: .bold)
                        .textSelection(.enabled)
                    if let subtitle = subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .scaledFont(.title3)
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
                                .scaledFont(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: addedAt))
                                .scaledFont(.caption)
                        }
                    }
                    if let modifiedAt = timestamps.modifiedAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Modified Time")
                                .scaledFont(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: modifiedAt))
                                .scaledFont(.caption)
                        }
                    }
                    if let lastSyncAt = timestamps.lastSyncAt {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Last Sync Time")
                                .scaledFont(.caption2)
                                .foregroundColor(.secondary)
                            Text(infoHeaderDateFormatter.string(from: lastSyncAt))
                                .scaledFont(.caption)
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
