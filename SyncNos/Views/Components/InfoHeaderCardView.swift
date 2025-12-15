import SwiftUI
import Combine

// MARK: - SyncQueueCollapseStore

/// 会话级的 Sync Queue 折叠状态（随应用重启重置）
/// 当有任务入队时自动展开
private final class SyncQueueCollapseStore: ObservableObject {
    static let shared = SyncQueueCollapseStore()
    @Published var isCollapsed: Bool = true
    
    private var cancellables = Set<AnyCancellable>()
    private var previousTaskCount: Int = 0
    
    init() {
        DIContainer.shared.syncQueueStore.tasksPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] tasks in
                guard let self else { return }
                let currentCount = tasks.count
                if currentCount > self.previousTaskCount && self.isCollapsed {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        self.isCollapsed = false
                    }
                }
                self.previousTaskCount = currentCount
            }
            .store(in: &cancellables)
    }
}

// MARK: - TimestampInfo

/// 时间戳信息结构
struct TimestampInfo {
    let addedAt: Date?
    let modifiedAt: Date?
    let lastSyncAt: Date?
    
    var hasAnyTimestamp: Bool {
        addedAt != nil || modifiedAt != nil || lastSyncAt != nil
    }
}

// MARK: - TimestampItemView

/// 单个时间戳显示项
struct TimestampItemView: View {
    let label: LocalizedStringKey
    let date: Date
    
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()
    
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .scaledFont(.caption2)
                .foregroundColor(.secondary)
            Text(Self.dateFormatter.string(from: date))
                .scaledFont(.caption)
        }
    }
}

// MARK: - SelectionPlaceholderView

/// 统一占位视图：空状态与多选占位合并，确保 SyncQueueView 视图身份稳定
struct SelectionPlaceholderView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @StateObject private var syncQueueCollapseStore = SyncQueueCollapseStore.shared
    
    let source: ContentSource
    let count: Int?
    let filteredCount: Int
    let totalCount: Int
    let onSyncSelected: (() -> Void)?

    init(
        source: ContentSource,
        count: Int? = nil,
        filteredCount: Int = 0,
        totalCount: Int = 0,
        onSyncSelected: (() -> Void)? = nil
    ) {
        self.source = source
        self.count = count
        self.filteredCount = filteredCount
        self.totalCount = totalCount
        self.onSyncSelected = onSyncSelected
    }

    private var isMultipleSelection: Bool { count ?? 0 > 0 && onSyncSelected != nil }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // App Logo
                let logoSize: CGFloat = 120 * fontScaleManager.scaleFactor
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .frame(width: logoSize, height: logoSize)

                // 标题 - 直接使用 ContentSource 的属性
                let titleFontSize: CGFloat = 56 * fontScaleManager.scaleFactor
                Text(source.title)
                    .font(.system(size: titleFontSize, weight: .bold, design: .rounded))
                    .fontWidth(.compressed)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundColor(source.accentColor)

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
                        
                        if totalCount > 0 {
                            Text("\(filteredCount)/\(totalCount)")
                                .scaledFont(.title3)
                                .monospacedDigit()
                                .foregroundColor(.secondary.opacity(0.7))
                        }
                    }
                    .padding(.bottom, 16)
                }

                // Sync Queue 区块
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

                    if !syncQueueCollapseStore.isCollapsed {
                        SyncQueueView()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .containerRelativeFrame(.vertical, alignment: .center)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

// MARK: - InfoHeaderCardView

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
            
            // 时间戳信息 - 使用 TimestampItemView 消除重复
            if let timestamps = timestamps, timestamps.hasAnyTimestamp {
                Divider()
                
                HStack(spacing: 16) {
                    if let addedAt = timestamps.addedAt {
                        TimestampItemView(label: "Added Time", date: addedAt)
                    }
                    if let modifiedAt = timestamps.modifiedAt {
                        TimestampItemView(label: "Modified Time", date: modifiedAt)
                    }
                    if let lastSyncAt = timestamps.lastSyncAt {
                        TimestampItemView(label: "Last Sync Time", date: lastSyncAt)
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
