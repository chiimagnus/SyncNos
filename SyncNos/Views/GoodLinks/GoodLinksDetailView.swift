import SwiftUI
import AppKit

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?
    
    // Freeze layout width during live resize to avoid heavy recomputation.
    @State private var isLiveResizing: Bool = false
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var frozenLayoutWidth: CGFloat? = nil

    var body: some View {
        Group {
            if let linkId = selectedLinkId, !linkId.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            // 文章信息卡片 - 使用统一卡片
                            InfoHeaderCardView(
                                title: link.title?.isEmpty == false ? link.title! : link.url,
                                subtitle: link.author,
                                overrideWidth: frozenLayoutWidth
                            ) {
                                // trailing 区域留空（可后续加分享/打开按钮）
                            } content: {
                                VStack(alignment: .leading, spacing: 10) {
                                    // URL 与原始URL
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 6) {
                                            Image(systemName: "link")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                            Text("URL")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                                .fontWeight(.medium)
                                        }
                                        Text(link.url)
                                            .font(.caption)
                                            .foregroundColor(.blue)
                                            .textSelection(.enabled)
                                            .lineLimit(3)
                                    }

                                    if let originalURL = link.originalURL, !originalURL.isEmpty, originalURL != link.url {
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack(spacing: 6) {
                                                Image(systemName: "arrow.turn.up.left")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                Text("原始URL")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                    .fontWeight(.medium)
                                            }
                                            Text(originalURL)
                                                .font(.caption)
                                                .foregroundColor(.blue)
                                                .textSelection(.enabled)
                                                .lineLimit(2)
                                        }
                                    }

                                    // 摘要
                                    if let summary = link.summary, !summary.isEmpty {
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack(spacing: 6) {
                                                Image(systemName: "doc.text")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                Text("摘要")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                    .fontWeight(.medium)
                                            }
                                            Text(summary)
                                                .font(.body)
                                                .foregroundColor(.primary)
                                                .textSelection(.enabled)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        .padding(.top, 4)
                                    }

                                    Divider()

                                    // 时间与统计
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(spacing: 16) {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("添加")
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Text(formatDate(link.addedAt))
                                                    .font(.caption)
                                            }
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("修改")
                                                    .font(.caption2)
                                                    .foregroundColor(.secondary)
                                                Text(formatDate(link.modifiedAt))
                                                    .font(.caption)
                                            }
                                            if link.readAt > 0 {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text("阅读")
                                                        .font(.caption2)
                                                        .foregroundColor(.secondary)
                                                    Text(formatDate(link.readAt))
                                                        .font(.caption)
                                                }
                                            }
                                        }
                                        HStack(spacing: 12) {
                                            if let total = link.highlightTotal, total > 0 {
                                                HStack(spacing: 6) {
                                                    Image(systemName: "highlighter")
                                                        .font(.caption)
                                                        .foregroundColor(.secondary)
                                                    Text("\(total) 个高亮")
                                                        .font(.caption)
                                                        .foregroundColor(.secondary)
                                                }
                                            }
                                            if let content = viewModel.contentByLinkId[linkId] {
                                                HStack(spacing: 6) {
                                                    Image(systemName: "doc.plaintext")
                                                        .font(.caption)
                                                        .foregroundColor(.secondary)
                                                    Text("\(content.wordCount) 字")
                                                        .font(.caption)
                                                        .foregroundColor(.secondary)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 全文内容
                        if let contentRow = viewModel.contentByLinkId[linkId], 
                           let fullText = contentRow.content, 
                           !fullText.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 6) {
                                    Image(systemName: "doc.text.fill")
                                        .font(.headline)
                                        .foregroundColor(.secondary)
                                    Text("文章全文")
                                        .font(.headline)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    Text("\(contentRow.wordCount) 字")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                .padding(.bottom, 4)
                                
                                Text(fullText)
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
                                        .onAppear { measuredLayoutWidth = w }
                                        .onChange(of: w) { newValue in
                                            measuredLayoutWidth = newValue
                                        }
                                }
                            )                            
                            .frame(maxWidth: frozenLayoutWidth, alignment: .leading)
                        }

                        // 高亮列表
                        let highlights = viewModel.highlightsByLinkId[linkId] ?? []
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Image(systemName: "quote.opening")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text("高亮笔记")
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                Spacer()
                                if highlights.isEmpty {
                                    Text("加载中...")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("\(highlights.count) 条")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .padding(.bottom, 4)
                            
                            if !highlights.isEmpty {
                                WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: frozenLayoutWidth) {
                                    ForEach(highlights, id: \.id) { item in
                                        HighlightCardView(
                                            colorMark: item.color.map { highlightColor(for: $0) } ?? Color.gray.opacity(0.5),
                                            content: item.content,
                                            note: item.note,
                                            createdDate: formatDate(item.time),
                                            modifiedDate: nil
                                        )
                                    }
                                }
                                .overlay(
                                    GeometryReader { proxy in
                                        let w = proxy.size.width
                                        Color.clear
                                            .onAppear { measuredLayoutWidth = w }
                                            .onChange(of: w) { newValue in
                                                measuredLayoutWidth = newValue
                                            }
                                    }
                                )
                            } else {
                                // 空状态提示
                                Text("该链接暂无高亮笔记")
                                    .font(.body)
                                    .foregroundColor(.secondary)
                                    .padding()
                            }
                        }
                    }
                    // .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .onAppear {
                    print("[GoodLinksDetailView] onAppear: linkId=\(linkId)")
                    viewModel.loadHighlights(for: linkId)
                    viewModel.loadContent(for: linkId)
                }
                .onChange(of: linkId) { newLinkId in
                    print("[GoodLinksDetailView] linkId changed to: \(newLinkId)")
                    viewModel.loadHighlights(for: newLinkId)
                    viewModel.loadContent(for: newLinkId)
                }
                .background(LiveResizeObserver(isResizing: $isLiveResizing))
                .onChange(of: isLiveResizing) { resizing in
                    if resizing {
                        frozenLayoutWidth = measuredLayoutWidth
                    } else {
                        frozenLayoutWidth = nil
                    }
                }
                .navigationTitle("GoodLinks")
            }
        }
    }
    
    // MARK: - Helper Functions
    
    /// 格式化时间戳为可读日期
    private func formatDate(_ timestamp: Double) -> String {
        guard timestamp > 0 else { return "未知" }
        let date = Date(timeIntervalSince1970: timestamp)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.string(from: date)
    }
    
    /// 根据GoodLinks的颜色值返回对应的SwiftUI Color
    /// GoodLinks使用整数表示颜色，具体映射可能需要根据实际情况调整
    private func highlightColor(for colorCode: Int) -> Color {
        switch colorCode {
        case 0: return .yellow
        case 1: return .red
        case 2: return .green
        case 3: return .blue
        case 4: return .purple
        default: return .gray
        }
    }
}
