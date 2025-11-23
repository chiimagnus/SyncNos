import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()

    var body: some View {
        List {
            Section(header: Text("Status")) {
                HStack {
                    Text("Pro Features Unlocked")
                    Spacer()
                    Image(systemName: viewModel.isProUnlocked ? "checkmark.seal.fill" : "xmark.seal")
                        .foregroundColor(viewModel.isProUnlocked ? .green : .secondary)
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
