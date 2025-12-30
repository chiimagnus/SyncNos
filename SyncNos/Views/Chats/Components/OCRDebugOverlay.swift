import SwiftUI
import AppKit

/// OCR Debug Overlay View
/// 在原始截图上叠加显示 OCR 识别的边界框和解析结果
struct OCRDebugOverlay: View {
    let image: NSImage
    let ocrResult: OCRResult
    let parsedMessages: [ChatMessage]
    let statistics: ChatParseStatistics
    
    @State private var showBboxes = true
    @State private var showClustering = true
    @State private var showStatistics = true
    @State private var selectedMessageId: UUID?
    
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                // 原始图片
                if let nsImage = image.resized(to: geometry.size) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .scaledToFit()
                }
                
                // OCR 边界框叠加
                if showBboxes {
                    bboxOverlay(imageSize: geometry.size)
                }
                
                // 聚类结果叠加
                if showClustering {
                    clusteringOverlay(imageSize: geometry.size)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            controlPanel
        }
        .overlay(alignment: .bottomLeading) {
            if showStatistics {
                statisticsPanel
            }
        }
    }
    
    // MARK: - Control Panel
    
    private var controlPanel: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Toggle("Show Bounding Boxes", isOn: $showBboxes)
            Toggle("Show Clustering", isOn: $showClustering)
            Toggle("Show Statistics", isOn: $showStatistics)
        }
        .toggleStyle(.checkbox)
        .scaledFont(.caption)
        .padding()
        .background(Color.black.opacity(0.7))
        .foregroundColor(.white)
        .cornerRadius(8)
        .padding()
    }
    
    // MARK: - Statistics Panel
    
    private var statisticsPanel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("OCR Parsing Statistics")
                .scaledFont(.caption)
                .bold()
            
            Divider()
                .background(Color.white)
            
            statRow("Input Blocks", value: "\(statistics.inputBlockCount)")
            statRow("Normalized", value: "\(statistics.normalizedBlockCount)")
            statRow("Lines", value: "\(statistics.lineCount)")
            statRow("Candidates", value: "\(statistics.candidateCount)")
            
            Divider()
                .background(Color.white)
            
            statRow("System", value: "\(statistics.systemMessageCount)", color: .yellow)
            statRow("Left (Other)", value: "\(statistics.leftBubbleCount)", color: .blue)
            statRow("Right (Me)", value: "\(statistics.rightBubbleCount)", color: .green)
        }
        .scaledFont(.caption2)
        .padding(12)
        .background(Color.black.opacity(0.7))
        .foregroundColor(.white)
        .cornerRadius(8)
        .padding()
    }
    
    private func statRow(_ label: String, value: String, color: Color = .white) -> some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .bold()
                .foregroundColor(color)
        }
    }
    
    // MARK: - Bounding Box Overlay
    
    @ViewBuilder
    private func bboxOverlay(imageSize: CGSize) -> some View {
        let coordinateSize = ocrResult.coordinateSize ?? imageSize
        
        ForEach(Array(ocrResult.blocks.enumerated()), id: \.offset) { index, block in
            let normalizedRect = normalizeRect(block.bbox, from: coordinateSize, to: imageSize)
            
            Rectangle()
                .stroke(Color.red.opacity(0.6), lineWidth: 1)
                .frame(width: normalizedRect.width, height: normalizedRect.height)
                .position(x: normalizedRect.midX, y: normalizedRect.midY)
                .overlay(
                    Text("\(index)")
                        .font(.system(size: 8))
                        .foregroundColor(.white)
                        .padding(2)
                        .background(Color.red.opacity(0.7))
                        .cornerRadius(2)
                        .position(x: normalizedRect.minX + 10, y: normalizedRect.minY + 10)
                )
        }
    }
    
    // MARK: - Clustering Overlay
    
    @ViewBuilder
    private func clusteringOverlay(imageSize: CGSize) -> some View {
        let coordinateSize = ocrResult.coordinateSize ?? imageSize
        
        ForEach(parsedMessages) { message in
            if let bbox = message.bbox {
                let normalizedRect = normalizeRect(bbox, from: coordinateSize, to: imageSize)
                let color = messageColor(for: message)
                
                Rectangle()
                    .fill(color.opacity(selectedMessageId == message.id ? 0.4 : 0.2))
                    .frame(width: normalizedRect.width, height: normalizedRect.height)
                    .position(x: normalizedRect.midX, y: normalizedRect.midY)
                    .overlay(
                        Rectangle()
                            .stroke(color, lineWidth: selectedMessageId == message.id ? 3 : 2)
                            .frame(width: normalizedRect.width, height: normalizedRect.height)
                            .position(x: normalizedRect.midX, y: normalizedRect.midY)
                    )
                    .onTapGesture {
                        selectedMessageId = message.id
                    }
            }
        }
        
        // 选中消息的详情
        if let selectedId = selectedMessageId,
           let message = parsedMessages.first(where: { $0.id == selectedId }),
           let bbox = message.bbox {
            let normalizedRect = normalizeRect(bbox, from: coordinateSize, to: imageSize)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(message.content)
                    .scaledFont(.caption)
                    .lineLimit(3)
                
                HStack {
                    Label(message.isFromMe ? "Me" : "Other", systemImage: "person")
                    Label(message.kind.rawValue, systemImage: "bubble")
                    if let name = message.senderName {
                        Label(name, systemImage: "person.text.rectangle")
                    }
                }
                .scaledFont(.caption2)
            }
            .padding(8)
            .background(Color.black.opacity(0.8))
            .foregroundColor(.white)
            .cornerRadius(6)
            .position(
                x: min(normalizedRect.maxX + 100, imageSize.width - 100),
                y: normalizedRect.midY
            )
        }
    }
    
    // MARK: - Helpers
    
    private func messageColor(for message: ChatMessage) -> Color {
        switch message.kind {
        case .system:
            return .yellow
        default:
            return message.isFromMe ? .green : .blue
        }
    }
    
    private func normalizeRect(_ rect: CGRect, from sourceSize: CGSize, to targetSize: CGSize) -> CGRect {
        let scaleX = targetSize.width / sourceSize.width
        let scaleY = targetSize.height / sourceSize.height
        
        return CGRect(
            x: rect.minX * scaleX,
            y: rect.minY * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY
        )
    }
}

// MARK: - NSImage Extension

extension NSImage {
    func resized(to size: CGSize) -> NSImage? {
        let aspectRatio = self.size.width / self.size.height
        let targetAspect = size.width / size.height
        
        var targetSize = size
        if aspectRatio > targetAspect {
            // 图片更宽，以宽度为准
            targetSize.height = size.width / aspectRatio
        } else {
            // 图片更高，以高度为准
            targetSize.width = size.height * aspectRatio
        }
        
        let newImage = NSImage(size: targetSize)
        newImage.lockFocus()
        
        let context = NSGraphicsContext.current
        context?.imageInterpolation = .high
        
        self.draw(
            in: NSRect(origin: .zero, size: targetSize),
            from: NSRect(origin: .zero, size: self.size),
            operation: .copy,
            fraction: 1.0
        )
        
        newImage.unlockFocus()
        return newImage
    }
}

#Preview {
    // Preview requires mock data
    OCRDebugOverlay(
        image: NSImage(systemSymbolName: "photo", accessibilityDescription: nil)!,
        ocrResult: OCRResult(blocks: [], coordinateSize: CGSize(width: 750, height: 1334)),
        parsedMessages: [],
        statistics: ChatParseStatistics(
            inputBlockCount: 20,
            normalizedBlockCount: 18,
            lineCount: 12,
            candidateCount: 10,
            systemMessageCount: 2,
            leftBubbleCount: 4,
            rightBubbleCount: 4
        )
    )
    .applyFontScale()
    .frame(width: 600, height: 800)
}
