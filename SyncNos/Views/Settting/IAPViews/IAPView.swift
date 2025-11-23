import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()

    var body: some View {
        List {
            Section(header: Text("Status")) {
                if viewModel.hasPurchased {
                    purchasedStatusView
                } else {
                    trialStatusView
                }
            }

            Section(header: Text("Subscription Plans")) {
                if viewModel.isLoading {
                    ProgressView()
                } else if viewModel.products.isEmpty {
                    Text("No products available.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.products, id: \.id) { product in
                        productRow(for: product)
                    }
                }
            }

            Section(header: Text("Actions")) {
                Button("Restore Purchases") {
                    viewModel.restore()
                }
                .buttonStyle(.bordered)
            }

            if let msg = viewModel.message, !msg.isEmpty {
                Section {
                    Text(msg)
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
            }

#if DEBUG
            Section(header: Text("Debug Actions")) {
                Button("Reset All IAP Data", action: {
                    viewModel.requestReset()
                })
                .buttonStyle(.bordered)

                Menu("Simulate State") {
                    Button("Purchased Annual") {
                        viewModel.simulateState(.purchasedAnnual)
                    }
                    Button("Purchased Lifetime") {
                        viewModel.simulateState(.purchasedLifetime)
                    }
                    Divider()
                    Button("Trial Day 23 (7 days left)") {
                        viewModel.simulateState(.trialDay(23))
                    }
                    Button("Trial Day 27 (3 days left)") {
                        viewModel.simulateState(.trialDay(27))
                    }
                    Button("Trial Day 29 (1 day left)") {
                        viewModel.simulateState(.trialDay(29))
                    }
                    Divider()
                    Button("Trial Expired") {
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
        .navigationTitle("Support")
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
                    .font(.headline)
                Spacer()
                Text("Active")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            
            // 显示购买日期
            if let purchaseDate = viewModel.purchaseDate {
                HStack {
                    Text("Purchased:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(purchaseDate, style: .date)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // 如果是年度订阅，显示到期时间
            if viewModel.purchaseType == .annual, let expirationDate = viewModel.expirationDate {
                HStack {
                    Text("Expires:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(expirationDate, style: .date)
                        .font(.caption)
                        .foregroundStyle(expirationDate < Date() ? .red : .secondary)
                }
                
                // 显示剩余天数
                let daysRemaining = Calendar.current.dateComponents([.day], from: Date(), to: expirationDate).day ?? 0
                if daysRemaining > 0 {
                    Text("\(daysRemaining) days left")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if daysRemaining == 0 {
                    Text("Expires today")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    Text("Expired")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            
            // 如果是终身，显示说明
            if viewModel.purchaseType == .lifetime {
                Text("Lifetime access - never expires")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var trialStatusView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: viewModel.isInTrialPeriod ? "clock.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(viewModel.isInTrialPeriod ? .blue : .red)
                Text("Trial Period")
                Spacer()
                if viewModel.isInTrialPeriod {
                    Text("\(viewModel.trialDaysRemaining) days left")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Expired")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            
            if viewModel.isInTrialPeriod {
                Text("Enjoy full access during your trial period.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Purchase to continue using SyncNos.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private func productRow(for product: Product) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.displayName)
                    .font(.headline)
                Text(product.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(product.displayPrice)
                    .font(.headline)
                Button(action: { viewModel.buy(product: product) }) {
                    Text("Purchase")
                        .font(.caption)
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.hasPurchased)
            }
        }
        .padding(.vertical, 4)
    }
}

struct IAPView_Previews: PreviewProvider {
    static var previews: some View {
        IAPView()
    }
}
