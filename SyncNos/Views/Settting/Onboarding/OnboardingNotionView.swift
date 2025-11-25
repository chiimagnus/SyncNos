import SwiftUI

// MARK: - Step 2: Connect Notion

struct OnboardingNotionView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            
            // 中央区域 - Notion 图标 + 标题
            HStack(spacing: 16) {
                Image(systemName: "n.square") // Notion
                    .font(.system(size: 120))
                    .foregroundStyle(Color("OnboardingTextColor"))
            
                Text("Notion\nOAuth")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color("OnboardingTextColor"))
                    .multilineTextAlignment(.leading)
            }
            
            Spacer()  // 弹性空间
            
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
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Color("OnboardingTextColor"))
                }
                
                Text(viewModel.workspaceName ?? "Workspace")
                    .font(.subheadline)
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
        VStack(spacing: 16) {
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Connect Your Notion")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Color("OnboardingTextColor"))
                    
                    Text("We'll create secure databases in your Notion workspace.")
                        .font(.subheadline)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                        .lineLimit(2)
                    
                    if let error = viewModel.notionErrorMessage {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
                
                Spacer()
                
                // 连接按钮
                Button(action: { viewModel.connectNotion() }) {
                    HStack(spacing: 8) {
                        if viewModel.isAuthorizingNotion {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("Connect")
                                .font(.headline)
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
            
            // Skip 按钮
            Button("Skip for now") {
                viewModel.nextStep()
            }
            .buttonStyle(.link)
            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
            .padding(.bottom, 40)
        }
    }
}

#Preview("Notion - Disconnected") {
    OnboardingNotionView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
}
