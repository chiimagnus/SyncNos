import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()

    var body: some View {
        List {
            Section(header: Text("Status")) {
                // Purchase Status
                if viewModel.hasPurchased {
                    HStack {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(.green)
                        Text("Pro Features Unlocked")
                        Spacer()
                        Text("Purchased")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                } else {
                    // Trial Status - Always show
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
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Support the Project")
        .onAppear { viewModel.onAppear() }
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
                .disabled(viewModel.isProUnlocked)
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
