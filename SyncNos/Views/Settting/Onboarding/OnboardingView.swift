import SwiftUI

struct OnboardingView: View {
    @StateObject private var viewModel = OnboardingViewModel()
    
    var body: some View {
        VStack {
            // Content with transition
            Group {
                switch viewModel.currentStep {
                case .welcome:
                    OnboardingWelcomeView(viewModel: viewModel)
                case .connectNotion:
                    OnboardingNotionView(viewModel: viewModel)
                case .enableSources:
                    OnboardingSourcesView(viewModel: viewModel)
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
            .id(viewModel.currentStep) // Force transition on step change
        }
        .frame(width: 600, height: 500) // Fixed size for onboarding window
        .frame(maxWidth: .infinity, maxHeight: .infinity) // 填满整个窗口
        .background(Color("BackgroundColor"))
    }
}

// MARK: - Step 1: Welcome
struct OnboardingWelcomeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        ZStack {
            // Logo Cluster - 整个视图的正中央（水平+垂直居中）
            ZStack {
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .shadow(radius: 6)
                    .frame(width: 180, height: 180)
                
                // Satellite Icons
                satelliteIcon("book.fill", color: .orange, angle: -90) // Apple Books
                satelliteIcon("bookmark.fill", color: .red, angle: 30) // GoodLinks
                satelliteIcon("text.book.closed.fill", color: .blue, angle: 150) // WeRead
            }
            
            // 底部区域 - 文字 + 箭头按钮
            VStack {
                Spacer()
                
                HStack(alignment: .center, spacing: 20) {
                    // 文字部分
                    VStack(alignment: .leading, spacing: 8) {
                        Text("All your highlights, unified.")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(Color("OnboardingTextColor"))
                        
                        Text("Sync Apple Books, GoodLinks, and WeRead highlights directly to your Notion database.")
                            .font(.subheadline)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(2)
                    }
                    
                    Spacer()
                    
                    // 右箭头按钮
                    Button(action: { viewModel.nextStep() }) {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 50, height: 50)
                            .background(Color("OnboardingButtonColor"))
                            .clipShape(Circle())
                            .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
        }
    }
    
    func satelliteIcon(_ systemName: String, color: Color, angle: Double) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 20))
            .foregroundStyle(.white)
            .padding(12)
            .background(color)
            .clipShape(Circle())
            .shadow(radius: 4)
            .offset(x: 120 * cos(angle * .pi / 180), y: 120 * sin(angle * .pi / 180))
    }
}

// MARK: - Step 2: Connect Notion
struct OnboardingNotionView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        ZStack {
            // 中央区域 - Notion 图标 + 标题
            VStack(spacing: 16) {
                Image(systemName: "n.square") // Notion
                    .font(.system(size: 80))
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Text("Connect Your Notion")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color("OnboardingTextColor"))
            }
            
            // 底部区域
            VStack {
                Spacer()
                
                if viewModel.isNotionConnected {
                    // 已连接状态
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
                        
                        Button(action: { viewModel.nextStep() }) {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 50, height: 50)
                                .background(Color("OnboardingButtonColor"))
                                .clipShape(Circle())
                                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 40)
                    .padding(.bottom, 40)
                } else {
                    // 未连接状态
                    HStack(alignment: .center, spacing: 20) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("We'll create secure databases in your Notion workspace.")
                                .font(.headline)
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
    }
}

// MARK: - Step 3: Enable Sources
struct OnboardingSourcesView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("Enable Sources")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(Color("OnboardingTextColor"))
                Text("Choose which apps you want to sync from.")
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
            }
            .padding(.top, 40)
            
            VStack(spacing: 16) {
                // Apple Books
                SourceToggleRow(
                    icon: "book.fill",
                    color: .orange,
                    title: "Apple Books",
                    isOn: $viewModel.appleBooksEnabled
                )
                
                // GoodLinks
                SourceToggleRow(
                    icon: "bookmark.fill",
                    color: .red,
                    title: "GoodLinks",
                    isOn: $viewModel.goodLinksEnabled
                )
                
                // WeRead
                SourceToggleRow(
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
            .padding(.horizontal, 40)
            
            Spacer()
            
            if let error = viewModel.sourceSelectionError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.bottom, -20)
            }
            
            Button(action: { viewModel.nextStep() }) {
                Text("Continue")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color("OnboardingButtonColor"))
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 60)
            .padding(.bottom, 40)
        }
    }
}

struct SourceToggleRow: View {
    let icon: String
    let color: Color
    let title: String
    @Binding var isOn: Bool
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(color)
                .cornerRadius(8)
            
            Text(title)
                .font(.headline)
                .foregroundStyle(Color("OnboardingTextColor"))
            
            Spacer()
            
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
        }
        .padding()
        .background(Color("OnboardingCardColor"))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color("OnboardingTextColor").opacity(0.15), lineWidth: 1)
        )
    }
}

// MARK: - Previews

#Preview("Onboarding") {
    OnboardingView()
}
