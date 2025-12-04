import SwiftUI

/// 字体大小设置视图
struct TextSizeSettingsView: View {
    @ObservedObject var fontScaleManager = FontScaleManager.shared
    @State private var selectedIndex: Double
    
    init() {
        _selectedIndex = State(initialValue: Double(FontScaleManager.shared.scaleLevel.index))
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // 标题和说明
            VStack(alignment: .leading, spacing: 8) {
                Text("Text Size")
                    .font(.title2.weight(.semibold))
                
                Text("Adjust the text size for the app. This setting affects all text throughout the application.")
                    .font(.body)
                    .foregroundColor(.secondary)
            }
            
            Divider()
            
            // 预览区域
            VStack(alignment: .leading, spacing: 12) {
                Text("Preview")
                    .font(.headline)
                    .foregroundColor(.secondary)
                
                previewCard
            }
            
            Divider()
            
            // 滑块控制
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Size")
                        .font(.headline)
                    Spacer()
                    Text(fontScaleManager.scaleLevel.displayName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                HStack(spacing: 8) {
                    // 小字体图标
                    Image(systemName: "textformat.size.smaller")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    // 滑块
                    Slider(
                        value: $selectedIndex,
                        in: 0...Double(FontScaleLevel.allCases.count - 1),
                        step: 1
                    ) { _ in }
                        .onChange(of: selectedIndex) { _, newValue in
                            fontScaleManager.scaleLevel = FontScaleLevel.from(index: Int(newValue))
                        }
                    
                    // 大字体图标
                    Image(systemName: "textformat.size.larger")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
                
                // 刻度标签
                HStack {
                    ForEach(Array(FontScaleLevel.allCases.enumerated()), id: \.element.id) { index, level in
                        if index > 0 {
                            Spacer()
                        }
                        Text(level.shortName)
                            .font(.caption2)
                            .foregroundColor(fontScaleManager.scaleLevel == level ? .primary : .secondary)
                    }
                }
            }
            
            // 重置按钮
            HStack {
                Spacer()
                Button("Reset to Default") {
                    withAnimation {
                        fontScaleManager.reset()
                        selectedIndex = Double(fontScaleManager.scaleLevel.index)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(fontScaleManager.scaleLevel == .medium)
            }
            
            Spacer()
        }
        .padding()
        .frame(minWidth: 400, maxWidth: 500)
    }
    
    // MARK: - Preview Card
    
    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Book Title")
                        .font(.system(size: Font.TextStyle.headline.basePointSize * fontScaleManager.scaleFactor, weight: .semibold))
                    Text("Author Name")
                        .font(.system(size: Font.TextStyle.subheadline.basePointSize * fontScaleManager.scaleFactor))
                        .foregroundColor(.secondary)
                    Text("42 highlights")
                        .font(.system(size: Font.TextStyle.caption.basePointSize * fontScaleManager.scaleFactor))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                    .font(.system(size: 16 * fontScaleManager.scaleFactor))
            }
            
            Divider()
            
            Text("This is a sample highlight text that demonstrates how the text size setting affects the reading experience in the app.")
                .font(.system(size: Font.TextStyle.body.basePointSize * fontScaleManager.scaleFactor))
                .lineSpacing(4 * fontScaleManager.scaleFactor)
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
    }
}

// MARK: - Preview

#Preview {
    TextSizeSettingsView()
}

