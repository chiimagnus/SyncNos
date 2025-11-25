import SwiftUI
import StoreKit

// MARK: - Step 4: Trial / Purchase

struct OnboardingTrialView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @StateObject private var iapViewModel = IAPViewModel()
    @State private var loadingPlanID: String? = nil
    
    var body: some View {
        ZStack {
            // 中央区域 - 产品列表
            VStack(spacing: 16) {
                // Trial badge
                trialBadge
                
                // Products
                productsSection
            }
            
            // 底部区域 - 与前三页保持一致
            VStack {
                Spacer()
                
                VStack(spacing: 12) {
                    HStack(alignment: .center, spacing: 20) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Start Your Free Trial")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundStyle(Color("OnboardingTextColor"))
                            
                            Text("30 days free, then choose a plan to continue syncing.")
                                .font(.subheadline)
                                .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                                .lineLimit(2)
                        }
                        
                        Spacer()
                        
                        // 开始试用按钮
                        OnboardingNextButton {
                            startTrial()
                        }
                    }
                    .padding(.horizontal, 40)
                    
                    // 底部链接
                    HStack(spacing: 16) {
                        // Restore purchases
                        Button("Restore Purchases") {
                            iapViewModel.restore()
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
        .onAppear {
            iapViewModel.onAppear()
        }
        .onChange(of: iapViewModel.isProUnlocked) { _, newValue in
            if newValue && iapViewModel.hasPurchased {
                // 购买成功，完成引导
                completeOnboarding()
            }
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
        if iapViewModel.isLoading {
            ProgressView()
                .padding()
        } else if iapViewModel.products.isEmpty {
            Text("Loading products...")
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
        } else {
            VStack(spacing: 12) {
                ForEach(iapViewModel.products, id: \.id) { product in
                    productCard(for: product)
                }
            }
            .padding(.horizontal, 60)
        }
        
        // Message display
        if let msg = iapViewModel.message, !msg.isEmpty {
            Text(msg)
                .font(.caption)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
        }
    }
    
    @ViewBuilder
    private func productCard(for product: Product) -> some View {
        let isLoading = loadingPlanID == product.id
        
        Button(action: {
            loadingPlanID = product.id
            Task {
                iapViewModel.buy(product: product)
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
        .disabled(iapViewModel.hasPurchased || isLoading)
    }
    
    // MARK: - Actions
    
    private func startTrial() {
        // 标记欢迎页已显示（试用期开始）
        DIContainer.shared.iapService.markWelcomeShown()
        // 完成引导流程
        completeOnboarding()
    }
    
    private func completeOnboarding() {
        viewModel.completeOnboarding()
    }
}

#Preview("Trial") {
    OnboardingTrialView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
}

