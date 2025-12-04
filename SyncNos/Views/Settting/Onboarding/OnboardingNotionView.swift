import SwiftUI

// MARK: - Step 2: Connect Notion

struct OnboardingNotionView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    private var notionIconSize: CGFloat { 120 * fontScaleManager.scaleFactor }
    private var subtitleFontSize: CGFloat { 24 * fontScaleManager.scaleFactor }
    
    var body: some View {
        VStack {
            Spacer()

            // 中央区域 - Notion 图标 + 标题
            HStack(spacing: 16) {
                Image(systemName: "n.square") // Notion
                    .font(.system(size: notionIconSize))
                    .foregroundStyle(Color("OnboardingTextColor"))
            
                Text("Notion OAuth")
                    .scaledFont(.largeTitle, weight: .bold)
                    .foregroundStyle(Color("OnboardingTextColor"))
                    .multilineTextAlignment(.leading)
            }

            Spacer()
            
            // 底部区域
            if viewModel.isNotionConnected {
                // 已连接状态
                connectedStateView
            } else {
                // 未连接状态
                disconnectedStateView
            }
        }
    }
    
    // MARK: - Connected State
    
    private var connectedStateView: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color("OnboardingButtonColor"))
                    Text("Connected")
                        .font(.system(size: subtitleFontSize, weight: .bold))
                        .foregroundStyle(Color("OnboardingTextColor"))
                }
                
                Text(viewModel.workspaceName ?? "Workspace")
                    .scaledFont(.subheadline)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
            }
            
            Spacer()
            
            OnboardingNextButton {
                viewModel.nextStep()
            }
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
    }
    
    // MARK: - Disconnected State
    
    private var disconnectedStateView: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect Your Notion")
                    .font(.system(size: subtitleFontSize, weight: .bold))
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Text("We'll create secure databases in your Notion workspace.")
                    .scaledFont(.subheadline)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                    .lineLimit(2)
                
                if let error = viewModel.notionErrorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                        .scaledFont(.caption)
                }
            }
            
            Spacer()

            // Skip 按钮
            Button("Skip") {
                viewModel.nextStep()
            }
            .buttonStyle(.link)
            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))

            // 连接按钮
            Button(action: { viewModel.connectNotion() }) {
                HStack(spacing: 8) {
                    if viewModel.isAuthorizingNotion {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Connect")
                            .scaledFont(.headline)
                    }
                }
                .foregroundColor(.white)
                .frame(width: 100, height: 44)
                .background(Color("OnboardingButtonColor"))
                .cornerRadius(22)
                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isAuthorizingNotion)
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
    }
}

#Preview("Notion - Disconnected") {
    OnboardingNotionView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}
