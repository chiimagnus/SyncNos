import SwiftUI

// MARK: - Step 3: Enable Sources

struct OnboardingSourcesView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        ZStack {
            // 中央区域 - 三个数据源卡片水平排列
            HStack(spacing: 24) {
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
            
            // 底部区域 - 与前两页保持一致
            VStack {
                Spacer()
                
                // 错误提示
                if let error = viewModel.sourceSelectionError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.bottom, 8)
                }
                
                HStack(alignment: .center, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Enable your datasources")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(Color("OnboardingTextColor"))
                        
                        Text("Select at least one source to sync your highlights.")
                            .font(.subheadline)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(2)
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
    }
}

// MARK: - Source Card

struct SourceCard: View {
    let icon: String
    let color: Color
    let title: String
    @Binding var isOn: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            // 图标
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundStyle(.white)
                .frame(width: 72, height: 72)
                .background(color)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: color.opacity(0.3), radius: 8, x: 0, y: 4)
            
            // 标题
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color("OnboardingTextColor"))
            
            // Toggle
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .controlSize(.mini)
                .labelsHidden()
        }
        .frame(width: 120)
    }
}

#Preview("Sources") {
    OnboardingSourcesView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
}
