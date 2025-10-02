import SwiftUI

// MARK: - 瀑布流布局
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
