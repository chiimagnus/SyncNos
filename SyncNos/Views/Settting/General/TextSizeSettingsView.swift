import SwiftUI

/// 字体大小设置视图
/// 
/// 允许用户调整应用内的字体大小。由于 macOS 不支持系统级 Dynamic Type，
/// 此视图提供了应用内的字体缩放功能。
struct TextSizeSettingsView: View {
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @State private var selectedIndex: Double
    
    init() {
        _selectedIndex = State(initialValue: Double(FontScaleManager.shared.scaleLevel.index))
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // 标题和说明
            headerSection
            
            Divider()
            
            // 预览区域
            previewSection
            
            Divider()
            
            // 滑块控制
            sliderSection
            
            // 重置按钮
            resetButton
            
            Spacer()
        }
        .padding()
        .frame(minWidth: 400, maxWidth: 500)
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Text Size")
                .scaledFont(.title2, weight: .semibold)
            
            Text("Adjust the text size for the app. This setting affects all text throughout the application.")
                .scaledFont(.body)
                .foregroundColor(.secondary)
        }
    }
    
    // MARK: - Preview Section
    
    private var previewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Preview")
                .scaledFont(.headline)
                .foregroundColor(.secondary)
            
            previewCard
        }
    }
    
    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Book Title")
                        .scaledFont(.headline, weight: .semibold)
                    Text("Author Name")
                        .scaledFont(.subheadline)
                        .foregroundColor(.secondary)
                    Text("42 highlights")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                    .scaledFont(.body)
            }
            
            Divider()
            
            Text("This is a sample highlight text that demonstrates how the text size setting affects the reading experience in the app.")
                .scaledFont(.body)
                .lineSpacing(4 * fontScaleManager.scaleFactor)
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
    }
    
    // MARK: - Slider Section
    
    private var sliderSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Size")
                    .scaledFont(.headline)
                Spacer()
                Text(fontScaleManager.scaleLevel.displayName)
                    .scaledFont(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            HStack(spacing: 8) {
                // 小字体图标
                Image(systemName: "textformat.size.smaller")
                    .scaledFont(.caption)
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
                    .scaledFont(.body)
                    .foregroundColor(.secondary)
            }
            
            // 刻度标签
            HStack {
                ForEach(Array(FontScaleLevel.allCases.enumerated()), id: \.element.id) { index, level in
                    if index > 0 {
                        Spacer()
                    }
                    Text(level.shortName)
                        .scaledFont(.caption2)
                        .foregroundColor(fontScaleManager.scaleLevel == level ? .primary : .secondary)
                }
            }
        }
    }
    
    // MARK: - Reset Button
    
    private var resetButton: some View {
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
    }
}

// MARK: - Preview

#Preview {
    TextSizeSettingsView()
}
