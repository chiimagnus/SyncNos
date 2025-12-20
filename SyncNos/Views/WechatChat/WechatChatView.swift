import SwiftUI
import UniformTypeIdentifiers

// MARK: - Wechat Chat View

/// 微信聊天记录 OCR 视图
struct WechatChatView: View {
    @StateObject private var viewModel = WechatChatViewModel()
    @State private var showFilePicker = false
    
    var body: some View {
        HSplitView {
            // 左侧：截图列表
            ScreenshotListView(
                screenshots: viewModel.screenshots,
                selectedId: $viewModel.selectedScreenshotId,
                onDelete: viewModel.deleteScreenshot,
                onAddTapped: { showFilePicker = true }
            )
            .frame(minWidth: 200, maxWidth: 300)
            
            // 右侧：消息预览
            MessagePreviewView(
                screenshot: viewModel.selectedScreenshot,
                isConfigured: viewModel.isConfigured
            )
            .frame(minWidth: 400)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    showFilePicker = true
                } label: {
                    Label("导入截图", systemImage: "photo.badge.plus")
                }
                .disabled(!viewModel.isConfigured || viewModel.isImporting)
                
                Button {
                    viewModel.copyToClipboard()
                } label: {
                    Label("复制文本", systemImage: "doc.on.doc")
                }
                .disabled(!viewModel.hasScreenshots)
                
                Button {
                    viewModel.clearAll()
                } label: {
                    Label("清除全部", systemImage: "trash")
                }
                .disabled(!viewModel.hasScreenshots)
            }
        }
        .overlay {
            if viewModel.isImporting {
                ProgressView("正在识别...")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.image],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                Task {
                    await viewModel.importScreenshots(urls: urls)
                }
            case .failure(let error):
                viewModel.error = error.localizedDescription
            }
        }
        .alert("错误", isPresented: .constant(viewModel.error != nil)) {
            Button("确定") {
                viewModel.error = nil
            }
        } message: {
            Text(viewModel.error ?? "")
        }
    }
}

// MARK: - Screenshot List View

private struct ScreenshotListView: View {
    let screenshots: [WechatScreenshot]
    @Binding var selectedId: UUID?
    let onDelete: (WechatScreenshot) -> Void
    let onAddTapped: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            // 标题栏
            HStack {
                Text("截图列表")
                    .font(.headline)
                Spacer()
                Text("\(screenshots.count)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(NSColor.controlBackgroundColor))
            
            Divider()
            
            // 截图列表
            if screenshots.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                    Text("暂无截图")
                        .foregroundColor(.secondary)
                    Button("导入截图") {
                        onAddTapped()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxHeight: .infinity)
            } else {
                List(selection: $selectedId) {
                    ForEach(screenshots) { screenshot in
                        ScreenshotCard(screenshot: screenshot)
                            .tag(screenshot.id)
                            .contextMenu {
                                Button("删除", role: .destructive) {
                                    onDelete(screenshot)
                                }
                            }
                    }
                }
                .listStyle(.sidebar)
            }
            
            Divider()
            
            // 添加按钮
            Button {
                onAddTapped()
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("添加截图")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .padding(8)
            .background(Color(NSColor.controlBackgroundColor))
        }
    }
}

// MARK: - Screenshot Card

private struct ScreenshotCard: View {
    let screenshot: WechatScreenshot
    
    var body: some View {
        HStack(spacing: 8) {
            // 缩略图
            Image(nsImage: screenshot.image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 50, height: 50)
                .cornerRadius(4)
                .clipped()
            
            VStack(alignment: .leading, spacing: 4) {
                // 状态
                if screenshot.isProcessing {
                    HStack(spacing: 4) {
                        ProgressView()
                            .scaleEffect(0.6)
                        Text("识别中...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else if let error = screenshot.error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .lineLimit(2)
                } else {
                    Text("\(screenshot.messages.count) 条消息")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                // 时间
                Text(screenshot.importedAt, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Message Preview View

private struct MessagePreviewView: View {
    let screenshot: WechatScreenshot?
    let isConfigured: Bool
    
    var body: some View {
        if !isConfigured {
            // 未配置 OCR
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 48))
                    .foregroundColor(.orange)
                Text("请先配置 PaddleOCR API")
                    .font(.headline)
                Text("前往 设置 → OCR 配置 API URL 和 Token")
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let screenshot = screenshot {
            if screenshot.isProcessing {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("正在识别...")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = screenshot.error {
                VStack(spacing: 12) {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 48))
                        .foregroundColor(.red)
                    Text("识别失败")
                        .font(.headline)
                    Text(error)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                MessageListView(messages: screenshot.messages)
            }
        } else {
            // 空状态
            VStack(spacing: 16) {
                Image(systemName: "message.badge.filled.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.secondary)
                Text("选择或导入截图")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Text("支持批量导入微信聊天截图")
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Message List View

private struct MessageListView: View {
    let messages: [WechatMessage]
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(messages) { message in
                    MessageRow(message: message)
                }
            }
            .padding()
        }
    }
}

// MARK: - Message Row

private struct MessageRow: View {
    let message: WechatMessage
    
    var body: some View {
        switch message.type {
        case .timestamp:
            TimestampRow(text: message.content)
        case .system:
            SystemMessageRow(text: message.content)
        case .text, .image, .voice:
            MessageBubble(message: message)
        }
    }
}

// MARK: - Timestamp Row

private struct TimestampRow: View {
    let text: String
    
    var body: some View {
        HStack {
            Rectangle()
                .fill(Color.secondary.opacity(0.3))
                .frame(height: 1)
            
            Text(text)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal, 8)
            
            Rectangle()
                .fill(Color.secondary.opacity(0.3))
                .frame(height: 1)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - System Message Row

private struct SystemMessageRow: View {
    let text: String
    
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(4)
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: WechatMessage
    
    private let myBubbleColor = Color(red: 0.58, green: 0.92, blue: 0.41) // #95EC69
    private let otherBubbleColor = Color.white
    
    var body: some View {
        HStack {
            if message.isFromMe {
                Spacer(minLength: 60)
            }
            
            VStack(alignment: message.isFromMe ? .trailing : .leading, spacing: 4) {
                // 发送者昵称（群聊）
                if let name = message.senderName, !message.isFromMe {
                    Text(name)
                        .font(.caption2)
                        .foregroundColor(Color(red: 0.34, green: 0.42, blue: 0.58)) // #576B95
                }
                
                // 消息内容
                Text(message.content)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(message.isFromMe ? myBubbleColor : otherBubbleColor)
                    .foregroundColor(.black)
                    .cornerRadius(8)
                    .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
            }
            
            if !message.isFromMe {
                Spacer(minLength: 60)
            }
        }
    }
}

// MARK: - Preview

#Preview {
    WechatChatView()
        .frame(width: 800, height: 600)
}

