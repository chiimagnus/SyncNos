import SwiftUI
import StoreKit

// MARK: - Step 4: Trial / Purchase (Unified)

/// 统一的试用期/付费墙视图
/// - 在 Onboarding 流程中作为第四步
/// - 在 MainListView 中作为独立付费墙
struct OnboardingTrialView: View {
    // Onboarding 模式时使用
    var onboardingViewModel: OnboardingViewModel?
    
    // 展示模式
    let presentationMode: TrialPresentationMode
    
    // 完成回调（非 Onboarding 模式时使用）
    var onFinish: (() -> Void)?
    
    @StateObject private var viewModel = TrialViewModel()
    @Environment(\.dismiss) private var dismiss
    
    // MARK: - Convenience Initializers
    
    /// Onboarding 模式初始化
    init(viewModel: OnboardingViewModel) {
        self.onboardingViewModel = viewModel
        self.presentationMode = .onboarding
        self.onFinish = nil
    }
    
    /// 独立付费墙模式初始化
    init(presentationMode: TrialPresentationMode, onFinish: (() -> Void)? = nil) {
        self.onboardingViewModel = nil
        self.presentationMode = presentationMode
        self.onFinish = onFinish
    }
    
    var body: some View {
        ZStack {
            // 中央区域 - 头部图标 + 产品列表
            VStack(spacing: 16) {
                // 非 Onboarding 模式显示头部图标
                if presentationMode != .onboarding {
                    headerIcon
                }
                
                // Trial badge（仅 Onboarding 模式显示）
                if presentationMode == .onboarding {
                    trialBadge
                }
                
                // Products
                productsSection
            }
            
            // 底部区域
            VStack {
                Spacer()
                
                VStack(spacing: 12) {
                    HStack(alignment: .center, spacing: 20) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(viewModel.headerTitle(for: presentationMode))
                                .font(.system(size: 24, weight: .bold))
                                .foregroundStyle(Color("OnboardingTextColor"))
                            
                            Text(viewModel.headerMessage(for: presentationMode))
                                .font(.subheadline)
                                .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                                .lineLimit(2)
                        }
                        
                        Spacer()
                        
                        // 主按钮
                        primaryActionButton
                    }
                    .padding(.horizontal, 40)
                    
                    // 底部链接
                    HStack(spacing: 16) {
                        // Restore purchases
                        Button("Restore Purchases") {
                            viewModel.restorePurchases()
                        }
                        .buttonStyle(.link)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                        
                        Text("•")
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.3))
                        
                        // Privacy Policy
                        Link("Privacy Policy", destination: URL(string: "https://chiimagnus.notion.site/privacypolicyandtermsofuse")!)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                    }
                    .font(.caption)
                    .padding(.bottom, 40)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("BackgroundColor"))
        .onAppear {
            viewModel.onAppear()
        }
        .onChange(of: viewModel.isProUnlocked) { _, newValue in
            if newValue && viewModel.hasPurchased {
                handlePurchaseSuccess()
            }
        }
    }
    
    // MARK: - Header Icon (非 Onboarding 模式)
    
    @ViewBuilder
    private var headerIcon: some View {
        Image(systemName: viewModel.headerIconName(for: presentationMode))
            .font(.system(size: 60))
            .foregroundStyle(headerIconColor)
    }
    
    private var headerIconColor: Color {
        switch viewModel.headerIconColorName(for: presentationMode) {
        case "green": return .green
        case "blue": return .blue
        case "orange": return .orange
        case "red": return .red
        case "yellow": return .yellow
        default: return .secondary
        }
    }
    
    // MARK: - Trial Badge
    
    private var trialBadge: some View {
        HStack(spacing: 8) {
            Image(systemName: "gift.fill")
                .foregroundStyle(.green)
            Text("30-day free trial included")
                .font(.headline)
                .foregroundStyle(Color("OnboardingTextColor"))
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.green.opacity(0.1))
        )
    }
    
    // MARK: - Products Section
    
    @ViewBuilder
    private var productsSection: some View {
        if viewModel.isLoading {
            ProgressView()
                .padding()
        } else if viewModel.products.isEmpty {
            Text("Loading products...")
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
        } else {
            VStack(spacing: 12) {
                ForEach(viewModel.products, id: \.id) { product in
                    productCard(for: product)
                }
            }
            .padding(.horizontal, 60)
        }
        
        // Message display
        if let msg = viewModel.message, !msg.isEmpty {
            Text(msg)
                .font(.caption)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
        }
    }
    
    @ViewBuilder
    private func productCard(for product: Product) -> some View {
        let isLoading = viewModel.loadingProductID == product.id
        
        Button(action: {
            viewModel.buyProduct(product)
        }) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(product.displayName)
                        .font(.headline)
                        .foregroundStyle(Color("OnboardingTextColor"))
                    Text(product.description)
                        .font(.caption)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                        .lineLimit(2)
                }
                Spacer()
                
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.8, anchor: .center)
                } else {
                    Text(product.displayPrice)
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color("OnboardingTextColor"))
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color("OnboardingCardColor").opacity(0.3))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color("OnboardingButtonColor").opacity(0.5), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(viewModel.hasPurchased || isLoading)
    }
    
    // MARK: - Primary Action Button
    
    @ViewBuilder
    private var primaryActionButton: some View {
        switch presentationMode {
        case .onboarding:
            OnboardingNextButton {
                startTrial()
            }
            
        case .trialReminder:
            Button(action: {
                viewModel.markReminderShown()
                finishFlow()
            }) {
                Text("Later")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(width: 80, height: 44)
                    .background(Color.secondary)
                    .cornerRadius(22)
            }
            .buttonStyle(.plain)
            
        case .trialExpired, .subscriptionExpired:
            // 过期状态下没有跳过按钮，必须购买
            EmptyView()
        }
    }
    
    // MARK: - Actions
    
    private func startTrial() {
        viewModel.markWelcomeShown()
        completeOnboarding()
    }
    
    private func handlePurchaseSuccess() {
        if presentationMode == .onboarding {
            viewModel.markWelcomeShown()
        }
        completeOnboarding()
    }
    
    private func completeOnboarding() {
        if let vm = onboardingViewModel {
            vm.completeOnboarding()
        } else {
            finishFlow()
        }
    }
    
    private func finishFlow() {
        if let onFinish = onFinish {
            onFinish()
        } else {
            dismiss()
        }
    }
}

// MARK: - Previews

#Preview("Onboarding Trial") {
    OnboardingTrialView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
}

#Preview("Trial Reminder - 7 Days") {
    OnboardingTrialView(presentationMode: .trialReminder(daysRemaining: 7))
        .frame(width: 600, height: 500)
}

#Preview("Trial Reminder - 3 Days") {
    OnboardingTrialView(presentationMode: .trialReminder(daysRemaining: 3))
        .frame(width: 600, height: 500)
}

#Preview("Trial Reminder - 1 Day") {
    OnboardingTrialView(presentationMode: .trialReminder(daysRemaining: 1))
        .frame(width: 600, height: 500)
}

#Preview("Trial Expired") {
    OnboardingTrialView(presentationMode: .trialExpired)
        .frame(width: 600, height: 500)
}

#Preview("Subscription Expired") {
    OnboardingTrialView(presentationMode: .subscriptionExpired)
        .frame(width: 600, height: 500)
}
