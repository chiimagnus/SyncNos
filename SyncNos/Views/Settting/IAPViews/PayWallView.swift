import SwiftUI
import StoreKit

/// 统一的 IAP 视图，根据不同状态显示不同内容，但始终包含购买选项
struct PayWallView: View {
    let presentationMode: IAPPresentationMode
    @StateObject private var viewModel = IAPViewModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openWindow) private var openWindow
    @State private var loadingPlanID: String? = nil
    
    var body: some View {
        VStack(spacing: 24) {
            // Header Section - 根据不同模式显示不同的头部
            headerSection
                .padding(.top, 40)
            
            // Products Section - 始终显示购买选项
            productsSection
            
            Spacer()
            
            // Actions Section
            actionsSection
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
        }
        .frame(width: 500, height: 600)
        .background(VisualEffectBackground(material: .windowBackground))
        .onAppear {
            viewModel.onAppear()
        }
        .onChange(of: viewModel.isProUnlocked) { _, newValue in
            if newValue {
                handlePurchaseSuccess()
            }
        }
    }
    
    // MARK: - Header Section
    
    @ViewBuilder
    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: headerIcon)
                .font(.system(size: 60))
                .foregroundStyle(headerIconColor)
            
            Text(headerTitle)
                .font(.title)
                .fontWeight(.bold)
            
            Text(headerMessage)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            // Trial info badge (if applicable)
            if case .welcome = presentationMode {
                trialBadge
            }
        }
    }
    
    private var trialBadge: some View {
        HStack(spacing: 8) {
            Image(systemName: "gift.fill")
                .foregroundStyle(.green)
            Text("30-day free trial included")
                .font(.headline)
                .foregroundStyle(.primary)
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
        VStack(spacing: 12) {
            Text("Choose Your Plan")
                .font(.headline)
                .foregroundStyle(.secondary)
            
            if viewModel.isLoading {
                ProgressView()
                    .padding()
            } else if viewModel.products.isEmpty {
                Text("Loading products...")
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 16) {
                    ForEach(viewModel.products, id: \.id) { product in
                        productCard(for: product)
                    }
                }
                .padding(.horizontal, 40)
            }
        }
    }
    
    @ViewBuilder
    private func productCard(for product: Product) -> some View {
        let isLoading = loadingPlanID == product.id
        
        Button(action: {
            loadingPlanID = product.id
            Task {
                viewModel.buy(product: product)
                // 购买流程完成后清空加载状态（无论成功或失败）
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5秒延迟，确保状态更新完成
                loadingPlanID = nil
            }
        }) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(product.displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(product.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                
                // 显示加载指示器或价格
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.8, anchor: .center)
                } else {
                    Text(product.displayPrice)
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.accentColor.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.accentColor, lineWidth: 2)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(viewModel.hasPurchased || isLoading)  // 已购买或正在加载时禁用
    }
    
    // MARK: - Actions Section
    
    @ViewBuilder
    private var actionsSection: some View {
        VStack(spacing: 12) {
            // Primary action button
            primaryActionButton
            
            // Restore purchases button
            Button("Restore Purchases") {
                viewModel.restore()
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            
            // Message display
            if let msg = viewModel.message, !msg.isEmpty {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    @ViewBuilder
    private var primaryActionButton: some View {
        switch presentationMode {
        case .welcome:
            Button(action: {
                DIContainer.shared.iapService.markWelcomeShown()
                dismiss()
            }) {
                Text("Start Free Trial")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
            
        case .trialReminder:
            Button(action: {
                DIContainer.shared.iapService.markReminderShown()
                dismiss()
            }) {
                Text("Remind Me Later")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.secondary)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
            
        case .trialExpired, .subscriptionExpired:
            // No primary action button for expired states
            EmptyView()
        }
    }
    
    // MARK: - Computed Properties
    
    private var headerIcon: String {
        switch presentationMode {
        case .welcome:
            return "book.circle.fill"
        case .trialReminder(let days):
            switch days {
            case 7: return "clock.badge.exclamationmark"
            case 3: return "exclamationmark.triangle.fill"
            case 1: return "exclamationmark.circle.fill"
            default: return "clock"
            }
        case .trialExpired:
            return "star.circle.fill"
        case .subscriptionExpired:
            return "exclamationmark.circle.fill"
        }
    }
    
    private var headerIconColor: Color {
        switch presentationMode {
        case .welcome:
            return .blue
        case .trialReminder(let days):
            switch days {
            case 7: return .blue
            case 3: return .orange
            case 1: return .red
            default: return .secondary
            }
        case .trialExpired:
            return .yellow
        case .subscriptionExpired:
            return .red
        }
    }
    
    private var headerTitle: String {
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
        switch presentationMode {
        case .welcome:
            return "Sync your highlights from Apple Books, GoodLinks, and WeRead to Notion effortlessly."
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
        
        // 如果当前是欢迎模式，标记已显示
        if case .welcome = presentationMode {
            logger.debug("Welcome mode detected, marking welcome as shown")
            DIContainer.shared.iapService.markWelcomeShown()
        }
        
        logger.debug("Dismissing paywall view")
        dismiss()
    }
}

// MARK: - Presentation Mode

enum IAPPresentationMode {
    case welcome
    case trialReminder(daysRemaining: Int)
    case trialExpired
    case subscriptionExpired  // 新增：年订阅已过期
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
