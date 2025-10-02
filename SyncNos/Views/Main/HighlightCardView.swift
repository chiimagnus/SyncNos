import SwiftUI

/// 通用的高亮卡片视图
struct HighlightCardView<AccessoryContent: View>: View {
    let colorMark: Color
    let content: String
    let note: String?
    let createdDate: String?
    let modifiedDate: String?
    let accessory: () -> AccessoryContent
    
    init(
        colorMark: Color,
        content: String,
        note: String? = nil,
        createdDate: String? = nil,
        modifiedDate: String? = nil,
        @ViewBuilder accessory: @escaping () -> AccessoryContent = { EmptyView() }
    ) {
        self.colorMark = colorMark
        self.content = content
        self.note = note
        self.createdDate = createdDate
        self.modifiedDate = modifiedDate
        self.accessory = accessory
    }
    
    var body: some View {
        ZStack(alignment: .topTrailing) {
            HStack(alignment: .top, spacing: 0) {
                // 左侧颜色标记
                RoundedRectangle(cornerRadius: 2)
                    .fill(colorMark)
                    .frame(width: 4)
                
                // 右侧内容区域
                VStack(alignment: .leading, spacing: 8) {
                    // 高亮内容
                    Text(content)
                        .font(.body)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    // 用户笔记（如果有）
                    if let note = note, !note.isEmpty {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "note.text")
                                .font(.caption)
                                .foregroundColor(.orange)
                            Text(note)
                                .font(.callout)
                                .foregroundColor(.primary)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.orange.opacity(0.08))
                        )
                    }
                    
                    // 时间信息
                    HStack(spacing: 12) {
                        if let created = createdDate {
                            HStack(spacing: 4) {
                                Image(systemName: "calendar.badge.plus")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text(created)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        
                        if let modified = modifiedDate {
                            HStack(spacing: 4) {
                                Image(systemName: "calendar.badge.clock")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text(modified)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 12)
                .padding(.vertical, 12)
                .padding(.trailing, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.gray.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
            )
            
            // 右上角附加按钮区域
            accessory()
                .padding(8)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

// MARK: - 瀑布流布局（从 AppleBookDetailView 移出来作为共享组件）

struct WaterfallLayout: Layout {
    var minColumnWidth: CGFloat = 280
    var spacing: CGFloat = 12
    var overrideWidth: CGFloat? = nil
    
    private func computeColumnInfo(width: CGFloat, subviews: Subviews) -> (positions: [CGPoint], totalHeight: CGFloat, columnWidth: CGFloat) {
        let safeWidth: CGFloat = (width.isFinite && width > 0) ? width : 1
        let safeSpacing: CGFloat = (spacing.isFinite && spacing >= 0) ? spacing : 0
        let safeMinWidth: CGFloat = (minColumnWidth.isFinite && minColumnWidth > 0) ? minColumnWidth : 1
        
        let denom = max(safeMinWidth + safeSpacing, 1)
        let rawColumnCount = (safeWidth + safeSpacing) / denom
        let columnCount = max(1, Int(rawColumnCount.isFinite ? rawColumnCount : 1))
        let computedColumnWidth = (safeWidth - CGFloat(columnCount - 1) * safeSpacing) / CGFloat(columnCount)
        let columnWidth = max(1, computedColumnWidth.isFinite ? computedColumnWidth : safeMinWidth)
        
        var columnHeights = Array(repeating: CGFloat(0), count: columnCount)
        var positions: [CGPoint] = Array(repeating: .zero, count: subviews.count)
        var maxHeight: CGFloat = 0
        
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: columnWidth, height: nil))
            let targetColumn = columnHeights.enumerated().min(by: { $0.element < $1.element })?.offset ?? 0
            let x = CGFloat(targetColumn) * (columnWidth + spacing)
            let y = columnHeights[targetColumn]
            positions[index] = CGPoint(x: x, y: y)
            columnHeights[targetColumn] = y + size.height + spacing
            maxHeight = max(maxHeight, columnHeights[targetColumn])
        }
        
        let totalHeight = max(0, maxHeight - spacing)
        return (positions, totalHeight, columnWidth)
    }
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let proposedWidth = proposal.width ?? 0
        guard proposedWidth > 0 else { return .zero }
        let usedWidth = overrideWidth ?? proposedWidth
        let info = computeColumnInfo(width: usedWidth, subviews: subviews)
        return CGSize(width: proposedWidth, height: info.totalHeight)
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let actualWidth = bounds.width
        guard actualWidth > 0 else { return }
        let usedWidth = overrideWidth ?? actualWidth
        let info = computeColumnInfo(width: usedWidth, subviews: subviews)
        for index in subviews.indices {
            let position = info.positions[index]
            let point = CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y)
            subviews[index].place(at: point, proposal: .init(width: info.columnWidth, height: nil))
        }
    }
}

