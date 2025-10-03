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
                        // .frame(maxWidth: .infinity, alignment: .leading)
                    
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
                        // .frame(maxWidth: .infinity, alignment: .leading)
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
                // .frame(maxWidth: .infinity, alignment: .leading)
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
