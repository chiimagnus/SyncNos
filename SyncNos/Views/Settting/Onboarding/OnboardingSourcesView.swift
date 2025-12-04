import SwiftUI

// MARK: - Step 3: Enable Sources

struct OnboardingSourcesView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    var body: some View {
        VStack {
            Spacer()

            // 中央区域 - 三个数据源卡片，根据字体缩放级别切换布局
            Group {
                if fontScaleManager.isAccessibilitySize {
                    // 辅助功能大小时使用垂直布局
                    VStack(spacing: 16) {
                        sourceCards
                    }
                } else {
                    // 标准大小时使用水平布局
                    HStack(spacing: 24) {
                        sourceCards
                    }
                }
            }
            
            Spacer()
            
            // 错误提示
            if let error = viewModel.sourceSelectionError {
                Text(error)
                    .scaledFont(.caption)
                    .foregroundStyle(.red)
                    .padding(.bottom, 8)
            }
            
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Enable your datasources")
                        .scaledFont(.title2, weight: .bold)
                        .foregroundStyle(Color("OnboardingTextColor"))
                    
                    Text("Select at least one source to sync your highlights.")
                        .scaledFont(.subheadline)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                
                Spacer()
                
                OnboardingNextButton {
                    viewModel.nextStep()
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
    }
    
    @ViewBuilder
    private var sourceCards: some View {
        SourceCard(
            icon: "book.fill",
            color: .orange,
            title: "Apple Books",
            isOn: $viewModel.appleBooksEnabled
        )
        
        SourceCard(
            icon: "bookmark.fill",
            color: .red,
            title: "GoodLinks",
            isOn: $viewModel.goodLinksEnabled
        )
        
        SourceCard(
            icon: "text.book.closed.fill",
            color: .blue,
            title: "WeRead",
            isOn: $viewModel.weReadEnabled
        )
        .onChange(of: viewModel.weReadEnabled) { _, newValue in
            if newValue && !viewModel.isWeReadLoggedIn {
                // We could show a tip here
            }
        }
    }
}

// MARK: - Source Card

struct SourceCard: View {
    let icon: String
    let color: Color
    let title: String
    @Binding var isOn: Bool
    
    @Environment(\.fontScale) private var fontScale
    
    private var iconSize: CGFloat { 32 * fontScale }
    private var iconContainerSize: CGFloat { 72 * fontScale }
    private var cardWidth: CGFloat { 120 * fontScale }
    
    var body: some View {
        VStack(spacing: 12) {
            // 图标
            Image(systemName: icon)
                .font(.system(size: iconSize))
                .foregroundStyle(.white)
                .frame(width: iconContainerSize, height: iconContainerSize)
                .background(color)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: color.opacity(0.3), radius: 8, x: 0, y: 4)
            
            // 标题
            Text(title)
                .scaledFont(.subheadline, weight: .medium)
                .foregroundStyle(Color("OnboardingTextColor"))
            
            // Toggle
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .controlSize(.mini)
                .labelsHidden()
        }
        .frame(minWidth: cardWidth)
    }
}

#Preview("Sources - Default") {
    OnboardingSourcesView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}
