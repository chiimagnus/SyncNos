import SwiftUI

// MARK: - OCR Payload Sheet View

/// 查看当前对话的 OCR Normalized Blocks 数据
struct WechatChatOCRPayloadSheet: View {
    let conversationId: String
    let conversationName: String
    
    @StateObject private var viewModel = OCRPayloadSheetViewModel()
    @State private var selectedIndex: Int = 0
    
    var body: some View {
        VStack(spacing: 0) {
            // 标题栏
            HStack {
                Text("OCR Blocks: \(conversationName)")
                    .font(.headline)
                
                Spacer()
                
                // 多截图时显示切换器
                if viewModel.payloads.count > 1 {
                    HStack(spacing: 8) {
                        Button {
                            if selectedIndex > 0 {
                                selectedIndex -= 1
                                loadCurrentDetail()
                            }
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .disabled(selectedIndex == 0)
                        
                        Text("\(selectedIndex + 1) / \(viewModel.payloads.count)")
                            .font(.caption)
                            .monospacedDigit()
                        
                        Button {
                            if selectedIndex < viewModel.payloads.count - 1 {
                                selectedIndex += 1
                                loadCurrentDetail()
                            }
                        } label: {
                            Image(systemName: "chevron.right")
                        }
                        .disabled(selectedIndex >= viewModel.payloads.count - 1)
                    }
                }
                
                Button {
                    if let detail = viewModel.detail {
                        copyToClipboard(formattedBlocks(detail: detail))
                    }
                } label: {
                    Label("复制", systemImage: "doc.on.doc")
                }
                .controlSize(.small)
                .disabled(viewModel.detail == nil)
            }
            .padding()
            .background(Color(nsColor: .windowBackgroundColor))
            
            Divider()
            
            // 内容区域
            contentView
        }
        .frame(minWidth: 600, minHeight: 400)
        .task {
            await viewModel.reload(conversationId: conversationId)
            loadCurrentDetail()
        }
    }
    
    @ViewBuilder
    private var contentView: some View {
        if let detail = viewModel.detail {
            VStack(spacing: 8) {
                // 元数据
                HStack {
                    Text("导入: \(detail.importedAt.formatted(date: .abbreviated, time: .shortened))")
                    Text("·")
                    Text("解析: \(detail.parsedAt.formatted(date: .abbreviated, time: .shortened))")
                    Spacer()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                
                // JSON 内容
                ScrollView {
                    Text(formattedBlocks(detail: detail))
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                }
                .background(Color(nsColor: .textBackgroundColor))
                .cornerRadius(6)
                .padding([.horizontal, .bottom], 12)
            }
        } else if viewModel.isLoading {
            ProgressView("加载中...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = viewModel.errorMessage {
            Text(error)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.payloads.isEmpty {
            Text("该对话暂无 OCR 数据")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Text("加载中...")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    private func loadCurrentDetail() {
        guard selectedIndex >= 0, selectedIndex < viewModel.payloads.count else { return }
        let screenshotId = viewModel.payloads[selectedIndex].screenshotId
        Task { await viewModel.loadDetail(screenshotId: screenshotId) }
    }
    
    /// 美化显示 Normalized Blocks JSON
    private func formattedBlocks(detail: WechatOcrPayloadDetail) -> String {
        let raw = detail.normalizedBlocksJSON
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
              let str = String(data: pretty, encoding: .utf8) else {
            return raw
        }
        return str
    }
    
    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

// MARK: - OCR Payload Sheet ViewModel

@MainActor
private final class OCRPayloadSheetViewModel: ObservableObject {
    @Published var payloads: [WechatOcrPayloadSummary] = []
    @Published var detail: WechatOcrPayloadDetail?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let cacheService: WechatChatCacheServiceProtocol = DIContainer.shared.wechatChatCacheService
    
    func reload(conversationId: String) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            // 获取所有截图，然后过滤当前对话
            let allPayloads = try await cacheService.fetchRecentOcrPayloads(limit: 100)
            payloads = allPayloads.filter { $0.conversationId == conversationId }
            errorMessage = nil
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
        }
    }
    
    func loadDetail(screenshotId: String) async {
        do {
            detail = try await cacheService.fetchOcrPayload(screenshotId: screenshotId)
            errorMessage = nil
        } catch {
            errorMessage = "读取失败: \(error.localizedDescription)"
        }
    }
}
