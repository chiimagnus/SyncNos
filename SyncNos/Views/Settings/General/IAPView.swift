import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()
    @State private var loadingPlanID: String? = nil

    var body: some View {
        List {
            Section(header: Text(String(localized: "Status", table: "Account"))) {
                if viewModel.hasPurchased {
                    // 当前有有效购买
                    purchasedStatusView
                } else if viewModel.hasEverPurchasedAnnual {
                    // 曾经购买过年订阅但已过期
                    expiredSubscriptionView
                } else {
                    // 从未购买过，显示试用期状态
                    trialStatusView
                }
            }

            Section(header: Text(String(localized: "Subscription Plans", table: "Account"))) {
                if viewModel.isLoading {
                    ProgressView()
                } else if viewModel.products.isEmpty {
                    Text(String(localized: "No products available.", table: "Account"))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.products, id: \.id) { product in
                        productRow(for: product)
                    }
                }
            }

            HStack {
                Button(String(localized: "Restore Purchases", table: "Common")) {
                    viewModel.restore()
                }
                .buttonStyle(.link)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))

                Text(String(localized: "•", table: "Common"))
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.3))

                Link("Privacy Policy & Terms of Use", destination: URL(string: "https://chiimagnus.notion.site/privacypolicyandtermsofuse")!)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                
                if let msg = viewModel.message, !msg.isEmpty {
                    Text(String(localized: "•", table: "Common"))
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.3))

                    Text(msg)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                }                
            }
            .scaledFont(.caption)

#if DEBUG
            Section(header: Text(String(localized: "Debug Actions", table: "Account"))) {
                Button(String(localized: "Reset All IAP Data", table: "Account"), action: {
                    viewModel.requestReset()
                })
                .buttonStyle(.bordered)

                Menu("Simulate State") {
                    Button(String(localized: "Purchased Annual", table: "Account")) {
                        viewModel.simulateState(.purchasedAnnual)
                    }
                    Button(String(localized: "Purchased Lifetime", table: "Account")) {
                        viewModel.simulateState(.purchasedLifetime)
                    }
                    Divider()
                    Button(String(localized: "Trial Day 23 (7 days left)", table: "Account")) {
                        viewModel.simulateState(.trialDay(23))
                    }
                    Button(String(localized: "Trial Day 27 (3 days left)", table: "Account")) {
                        viewModel.simulateState(.trialDay(27))
                    }
                    Button(String(localized: "Trial Day 29 (1 day left)", table: "Account")) {
                        viewModel.simulateState(.trialDay(29))
                    }
                    Divider()
                    Button(String(localized: "Trial Expired", table: "Account")) {
                        viewModel.simulateState(.trialExpired)
                    }
                }
                .buttonStyle(.bordered)
            }
#endif
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle(String(localized: "Support", table: "Common"))
        .onAppear {
            viewModel.onAppear()
        }
    }

    // MARK: - Production Views

    private var purchasedStatusView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundColor(.green)
                Text(viewModel.purchaseType.displayName)
                    .scaledFont(.headline)
                Spacer()
                Text(String(localized: "Active", table: "Account"))
                    .scaledFont(.caption)
                    .foregroundStyle(.green)
            }
            
            // 显示购买日期
            if let purchaseDate = viewModel.purchaseDate {
                HStack {
                    Text(String(localized: "Purchased:", table: "Account"))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                    Text(purchaseDate.formatted(date: .abbreviated, time: .standard))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // 如果是年度订阅，显示到期时间
            if viewModel.purchaseType == .annual, let expirationDate = viewModel.expirationDate {
                HStack {
                    Text(String(localized: "Expires:", table: "Account"))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                    Text(expirationDate.formatted(date: .abbreviated, time: .standard))
                        .scaledFont(.caption)
                        .foregroundStyle(expirationDate < Date() ? .red : .secondary)
                }
            }
        }
    }

    private var trialStatusView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: viewModel.isInTrialPeriod ? "clock.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(viewModel.isInTrialPeriod ? .blue : .red)
                Text(String(localized: "Trial Period", table: "Account"))
                    .scaledFont(.body)
                Spacer()
                if viewModel.isInTrialPeriod {
                    Text("\(viewModel.trialDaysRemaining) days left")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(String(localized: "Expired", table: "Account"))
                        .scaledFont(.caption)
                        .foregroundStyle(.red)
                }
            }
            
            if viewModel.isInTrialPeriod {
                Text(String(localized: "Enjoy full access during your trial period.", table: "Account"))
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(String(localized: "Purchase to continue using SyncNos.", table: "Account"))
                    .scaledFont(.caption)
                    .foregroundStyle(.red)
            }
        }
    }
    
    private var expiredSubscriptionView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundColor(.red)
                Text(String(localized: "Annual Subscription", table: "Account"))
                    .scaledFont(.headline)
                Spacer()
                Text(String(localized: "Expired", table: "Account"))
                    .scaledFont(.caption)
                    .foregroundStyle(.red)
            }
            
            // 显示购买日期
            if let purchaseDate = viewModel.purchaseDate {
                HStack {
                    Text(String(localized: "Purchased:", table: "Account"))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                    Text(purchaseDate.formatted(date: .abbreviated, time: .standard))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // 显示到期时间
            if let expirationDate = viewModel.expirationDate {
                HStack {
                    Text(String(localized: "Expired:", table: "Account"))
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                    Text(expirationDate.formatted(date: .abbreviated, time: .standard))
                        .scaledFont(.caption)
                        .foregroundStyle(.red)
                }
            }
            
            Text(String(localized: "Your subscription has expired. Renew to continue using SyncNos.", table: "Account"))
                .scaledFont(.caption)
                .foregroundStyle(.red)
        }
    }

    @ViewBuilder
    private func productRow(for product: Product) -> some View {
        let isLoading = loadingPlanID == product.id

        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.displayName)
                    .scaledFont(.headline)
                Text(product.description)
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(product.displayPrice)
                    .scaledFont(.headline)
                Button(action: {
                    loadingPlanID = product.id
                    Task {
                        viewModel.buy(product: product)
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        loadingPlanID = nil
                    }
                }) {
                    if isLoading {
                        ProgressView()
                            .scaleEffect(0.8, anchor: .center)
                    } else {
                        Text(String(localized: "Purchase", table: "Account"))
                            .scaledFont(.caption)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.hasPurchased || isLoading)
            }
        }
        .padding(.vertical, 4)
    }
}

struct IAPView_Previews: PreviewProvider {
    static var previews: some View {
        IAPView()
            .applyFontScale()
    }
}
