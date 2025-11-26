import SwiftUI
import StoreKit

/// 统一的 IAP 视图，根据不同状态显示不同内容，但始终包含购买选项
/// 采用 Onboarding 风格的底部布局
struct PayWallView: View {
    let presentationMode: IAPPresentationMode
    var onFinish: (() -> Void)? = nil
    @StateObject private var viewModel = IAPViewModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openWindow) private var openWindow
    @State private var loadingPlanID: String? = nil
    
    // 动画状态
    @State private var wiggleAngle: Double = 0  // 礼物图标摇摆
    @State private var headerIconScale: CGFloat = 1.0  // 图标脉冲放大
    @State private var headerIconShake: CGFloat = 0  // 图标颤抖
    
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            
            // 中央区域 - 头部图标 + 产品列表
            VStack(spacing: 16) {
                // Header Icon with animations
                headerIconView
                
                // Products Section
                productsSection
            }
            
            Spacer()
            
            // 底部区域 - Onboarding 风格布局
            bottomSection
        }
        .frame(width: 600, height: 500)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("BackgroundColor"))
        .onAppear {
            viewModel.onAppear()
        }
        .onChange(of: viewModel.isProUnlocked) { _, newValue in
            if newValue {
                handlePurchaseSuccess()
            }
        }
    }
    
    // MARK: - Header Icon View
    
    @ViewBuilder
    private var headerIconView: some View {
        if case .welcome = presentationMode {
            // Welcome 模式：礼物图标 + 摇摆动画
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
        } else {
            // 其他模式：常规图标 + 脉冲动画（紧急提醒时）
            Image(systemName: headerIcon)
                .font(.system(size: 60))
                .foregroundStyle(headerIconColor)
                .scaleEffect(shouldPulseHeaderIcon ? headerIconScale : 1.0)
                .offset(x: shouldPulseHeaderIcon ? headerIconShake : 0)
                .onAppear {
                    if shouldPulseHeaderIcon {
                        startHeaderIconPulse()
                    }
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
    
    /// 启动礼物图标摇摆动画
    private func startWiggleAnimation() {
        func performWiggle() {
            let wiggleDuration = 0.1
            let wiggleAngleValue = 10.0
            let sequence: [Double] = [-wiggleAngleValue, wiggleAngleValue, -wiggleAngleValue, wiggleAngleValue, -wiggleAngleValue * 0.5, 0]
            
            for (index, angle) in sequence.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + wiggleDuration * Double(index)) {
                    withAnimation(.easeInOut(duration: wiggleDuration)) {
                        wiggleAngle = angle
                    }
                }
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            performWiggle()
        }
        
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            performWiggle()
        }
    }
    
    /// 启动 Header Icon 脉冲放大 + 颤抖动画
    private func startHeaderIconPulse() {
        func performPulseAndShake() {
            withAnimation(.easeOut(duration: 0.2)) {
                headerIconScale = 1.35
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                performShake()
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2 + 0.4) {
                withAnimation(.easeIn(duration: 0.15)) {
                    headerIconScale = 1.0
                }
            }
        }
        
        func performShake() {
            let shakeDuration = 0.05
            let shakeSequence: [CGFloat] = [-6, 6, -5, 5, -3, 3, -2, 0]
            
            for (index, offset) in shakeSequence.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + shakeDuration * Double(index)) {
                    withAnimation(.linear(duration: shakeDuration)) {
                        headerIconShake = offset
                    }
                }
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            performPulseAndShake()
        }
        
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            performPulseAndShake()
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
            Button("Restore Purchases") {
                viewModel.restore()
            }
            .buttonStyle(.link)
            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
            
            Text("•")
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.3))
            
            Link("Privacy Policy & Terms of Use", destination: URL(string: "https://chiimagnus.notion.site/privacypolicyandtermsofuse")!)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
            
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
        let isLoading = loadingPlanID == product.id
        
        Button(action: {
            loadingPlanID = product.id
            Task {
                viewModel.buy(product: product)
                try? await Task.sleep(nanoseconds: 500_000_000)
                loadingPlanID = nil
            }
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
    
    // MARK: - Bottom Section (Onboarding Style)
    
    @ViewBuilder
    private var bottomSection: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text(headerTitle)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Text(headerMessage)
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
    
    // MARK: - Primary Action Button
    
    @ViewBuilder
    private var primaryActionButton: some View {
        switch presentationMode {
        case .welcome:
            // 欢迎模式：圆形箭头按钮
            OnboardingNextButton {
                DIContainer.shared.iapService.markWelcomeShown()
                if let onFinish = onFinish {
                    onFinish()
                } else {
                    dismiss()
                }
            }
            
        case .trialReminder:
            if viewModel.hasPurchased {
                OnboardingNextButton {
                    if let onFinish = onFinish {
                        onFinish()
                    } else {
                        dismiss()
                    }
                }
            } else {
                Button(action: {
                    DIContainer.shared.iapService.markReminderShown()
                    if let onFinish = onFinish {
                        onFinish()
                    } else {
                        dismiss()
                    }
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
            if viewModel.hasPurchased {
                OnboardingNextButton {
                    if let onFinish = onFinish {
                        onFinish()
                    } else {
                        dismiss()
                    }
                }
            } else {
                EmptyView()
            }
        }
    }
    
    // MARK: - Computed Properties
    
    private var headerIcon: String {
        switch presentationMode {
        case .welcome:
            return "gift.fill"
        case .trialReminder(let days):
            switch days {
            case 7: return "clock.badge.exclamationmark"
            case 3: return "exclamationmark.triangle.fill"
            case 1: return "exclamationmark.circle.fill"
            default: return "clock"
            }
        case .trialExpired:
            return "face.dashed.fill"
        case .subscriptionExpired:
            return "exclamationmark.circle.fill"
        }
    }
    
    private var headerIconColor: Color {
        switch presentationMode {
        case .welcome:
            return .green
        case .trialReminder(let days):
            switch days {
            case 7: return .blue
            case 3: return .orange
            case 1: return .red
            default: return .secondary
            }
        case .trialExpired:
            return Color(white: 0.4)
        case .subscriptionExpired:
            return .red
        }
    }
    
    private var headerTitle: String {
        if viewModel.hasPurchased {
            return "Purchase Successful!"
        }
        
        switch presentationMode {
        case .welcome:
            return "Welcome to SyncNos"
        case .trialReminder(let days):
            switch days {
            case 7: return "Trial Ending Soon"
            case 3: return "Only 3 Days Left"
            case 1: return "Last Day of Trial"
            default: return "Trial Reminder"
            }
        case .trialExpired:
            return "Trial Period Ended"
        case .subscriptionExpired:
            return "Subscription Expired"
        }
    }
    
    private var headerMessage: String {
        if viewModel.hasPurchased {
            return "Thank you for your support!"
        }
        
        switch presentationMode {
        case .welcome:
            return "Sync your highlights from Apple Books, GoodLinks, and WeRead to Notion. Start your 30-day free trial!"
        case .trialReminder(let days):
            return "Your free trial will expire in \(days) day\(days == 1 ? "" : "s"). Purchase now to continue enjoying unlimited syncing."
        case .trialExpired:
            return "Your 30-day free trial has expired. Purchase to continue using SyncNos."
        case .subscriptionExpired:
            return "Your annual subscription has expired. Renew now to continue syncing your highlights."
        }
    }
    
    // MARK: - Actions
    
    private func handlePurchaseSuccess() {
        let logger = DIContainer.shared.loggerService
        logger.info("Purchase successful, handling completion")
        
        if case .welcome = presentationMode {
            logger.debug("Welcome mode detected, marking welcome as shown")
            DIContainer.shared.iapService.markWelcomeShown()
        }
        
        if let onFinish = onFinish {
            onFinish()
        } else {
            logger.debug("Dismissing paywall view")
            dismiss()
        }
    }
}

// MARK: - Presentation Mode

enum IAPPresentationMode {
    case welcome
    case trialReminder(daysRemaining: Int)
    case trialExpired
    case subscriptionExpired
}

// MARK: - Previews

#Preview("Welcome") {
    PayWallView(presentationMode: .welcome)
}

#Preview("Trial Reminder - 7 Days") {
    PayWallView(presentationMode: .trialReminder(daysRemaining: 7))
}

#Preview("Trial Reminder - 3 Days") {
    PayWallView(presentationMode: .trialReminder(daysRemaining: 3))
}

#Preview("Trial Reminder - 1 Day") {
    PayWallView(presentationMode: .trialReminder(daysRemaining: 1))
}

#Preview("Trial Expired") {
    PayWallView(presentationMode: .trialExpired)
}

#Preview("Subscription Expired") {
    PayWallView(presentationMode: .subscriptionExpired)
}
