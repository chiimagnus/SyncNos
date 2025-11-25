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
    
    // Gift 图标摇摆动画状态
    @State private var wiggleAngle: Double = 0
    
    // Header 图标放大动画状态
    @State private var headerIconScale: CGFloat = 1.0
    
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
        VStack(spacing: 0) {
            Spacer()
            
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
            
            Spacer()  // 弹性空间
            
            // 底部区域
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
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("BackgroundColor"))
        .onAppear {
            viewModel.onAppear()
        }
        .onChange(of: viewModel.hasPurchased) { _, newValue in
            if newValue {
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
            .scaleEffect(shouldPulseHeaderIcon ? headerIconScale : 1.0)
            .onAppear {
                if shouldPulseHeaderIcon {
                    startHeaderIconPulse()
                }
            }
    }
    
    /// 是否应该给 Header Icon 添加脉冲动画（仅限紧急提醒：3天和1天）
    private var shouldPulseHeaderIcon: Bool {
        if case .trialReminder(let days) = presentationMode {
            return days <= 3
        }
        return false
    }
    
    /// 启动 Header Icon 脉冲放大动画
    private func startHeaderIconPulse() {
        // 执行一次脉冲动画
        func performPulse() {
            withAnimation(.easeOut(duration: 0.2)) {
                headerIconScale = 1.35
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                withAnimation(.easeIn(duration: 0.15)) {
                    headerIconScale = 1.0
                }
            }
        }
        
        // 立即开始第一次动画
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            performPulse()
        }
        
        // 循环放大动画（每 1.5 秒一次）
        Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
            performPulse()
        }
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
        VStack(spacing: 12) {
            Image(systemName: "gift.fill")
                .font(.system(size: 60))
                .foregroundStyle(.green)
                .rotationEffect(.degrees(wiggleAngle), anchor: .bottom)
                .onAppear {
                    startWiggleAnimation()
                }
            Text("30-day free trial included")
                .font(.headline)
                .foregroundStyle(Color("OnboardingTextColor"))
        }
    }
    
    /// 启动摇摆动画循环
    private func startWiggleAnimation() {
        // 执行一次完整的摇摆序列
        func performWiggle() {
            let wiggleDuration = 0.1
            let wiggleAngleValue = 10.0
            
            // 摇摆序列：左 -> 右 -> 左 -> 右 -> 左 -> 中
            let sequence: [Double] = [-wiggleAngleValue, wiggleAngleValue, -wiggleAngleValue, wiggleAngleValue, -wiggleAngleValue * 0.5, 0]
            
            for (index, angle) in sequence.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + wiggleDuration * Double(index)) {
                    withAnimation(.easeInOut(duration: wiggleDuration)) {
                        wiggleAngle = angle
                    }
                }
            }
        }
        
        // 立即开始第一次摇摆
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            performWiggle()
        }
        
        // 循环摇摆（每 3 秒一次）
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            performWiggle()
        }
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
        
        // 链接和消息行
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
            
            // Message display（购买成功后不显示，因为底部已经有成功提示）
            if !viewModel.hasPurchased, let msg = viewModel.message, !msg.isEmpty {
                Text("•")
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.3))
                Text(msg)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
            }
        }
        .font(.caption)
        .padding(.top, 16)
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
            // Onboarding 模式：始终显示箭头按钮
            OnboardingNextButton {
                handleOnboardingNext()
            }
            
        case .trialReminder:
            if viewModel.hasPurchased {
                // 购买成功后显示箭头按钮
                OnboardingNextButton {
                    finishFlow()
                }
            } else {
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
            }
            
        case .trialExpired, .subscriptionExpired:
            // 过期状态下：购买成功后显示箭头按钮，否则不显示
            if viewModel.hasPurchased {
                OnboardingNextButton {
                    finishFlow()
                }
            } else {
                EmptyView()
            }
        }
    }
    
    // MARK: - Actions
    
    private func handleOnboardingNext() {
        // Onboarding 模式下点击箭头：标记欢迎页已显示，然后完成
        viewModel.markWelcomeShown()
        completeOnboarding()
    }
    
    private func handlePurchaseSuccess() {
        // 购买成功后，仅在非 Onboarding 模式下自动完成流程
        // Onboarding 模式下，用户需要手动点击箭头按钮
        if presentationMode != .onboarding {
            finishFlow()
        }
        // Onboarding 模式下，不做任何事情，等待用户点击箭头
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
