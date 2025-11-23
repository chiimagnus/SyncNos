import SwiftUI
import StoreKit

struct PaywallView: View {
    @StateObject private var viewModel = IAPViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            // Header
            VStack(spacing: 12) {
                Image(systemName: "star.circle.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(.yellow)

                Text("Trial Period Ended")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Your 30-day free trial has expired. Purchase to continue using SyncNos.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding(.top, 40)

            // Products
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

            Spacer()

            // Restore button
            Button("Restore Purchases") {
                viewModel.restore()
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)

            if let msg = viewModel.message, !msg.isEmpty {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
        }
        .frame(width: 500, height: 600)
        .background(VisualEffectBackground(material: .windowBackground))
        .onAppear {
            viewModel.onAppear()
        }
        .onChange(of: viewModel.isProUnlocked) { _, newValue in
            if newValue {
                dismiss()
            }
        }
    }

    @ViewBuilder
    private func productCard(for product: Product) -> some View {
        Button(action: { viewModel.buy(product: product) }) {
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
                Text(product.displayPrice)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
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
    }
}

struct PaywallView_Previews: PreviewProvider {
    static var previews: some View {
        PaywallView()
    }
}
