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
            
            // 滑块控制
            sliderSection
            
            // 快捷键提示
            shortcutHint
            
            // 重置按钮
            resetButton
            
            Spacer()
        }
        .padding()
        .frame(minWidth: 400, maxWidth: 500)
        .navigationTitle("Text Size")
        // 同步外部变化（如通过快捷键修改）
        .onChange(of: fontScaleManager.scaleLevel) { _, newLevel in
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedIndex = Double(newLevel.index)
            }
        }
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Adjust the text size for the app. This setting affects all text throughout the application.")
                .scaledFont(.body)
                .foregroundColor(.secondary)
        }
    }
    
    // MARK: - Slider Section
    
    private var sliderSection: some View {
        VStack(alignment: .leading, spacing: 12) {
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
            HStack(spacing: 8) {
                Image(systemName: "textformat.size.smaller")
                    .scaledFont(.caption)
                    .opacity(0)
                ForEach(Array(FontScaleLevel.allCases.enumerated()), id: \.element.id) { index, level in
                    if index > 0 {
                        Spacer()
                    }
                    Text(level.shortName)
                        .scaledFont(.caption2)
                        .foregroundColor(fontScaleManager.scaleLevel == level ? .primary : .secondary)
                }
                Image(systemName: "textformat.size.larger")
                    .scaledFont(.body)
                    .opacity(0)
            }
        }
    }
    
    // MARK: - Shortcut Hint
    
    private var shortcutHint: some View {
        HStack(spacing: 16) {
            shortcutItem(key: "⌘+", label: "Increase")
            shortcutItem(key: "⌘-", label: "Decrease")
            shortcutItem(key: "⌘0", label: "Reset")
        }
        .scaledFont(.caption)
        .foregroundColor(.secondary)
    }
    
    private func shortcutItem(key: String, label: LocalizedStringKey) -> some View {
        HStack(spacing: 4) {
            Text(key)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color(NSColor.tertiaryLabelColor).opacity(0.2))
                .cornerRadius(4)
            Text(label)
        }
    }
    
    // MARK: - Reset Button
    
    private var resetButton: some View {
        HStack {
            Spacer()
            Button("Reset") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    fontScaleManager.reset()
                    selectedIndex = Double(fontScaleManager.scaleLevel.index)
                }
            }
            .buttonStyle(.bordered)
            .disabled(fontScaleManager.isDefaultSize)
        }
    }
}

// MARK: - Preview

#Preview {
    TextSizeSettingsView()
}
