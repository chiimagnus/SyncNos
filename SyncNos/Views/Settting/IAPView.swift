import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Support SyncNos")
                    .font(.title2.bold())
                Spacer()
                if viewModel.isProUnlocked {
                    Label("Pro Unlocked", systemImage: "checkmark.seal.fill")
                        .foregroundColor(.green)
                }
            }

            if let error = viewModel.errorMessage {
                Text(error)
                    .foregroundColor(.red)
            }

            if viewModel.products.isEmpty {
                ProgressView()
            } else {
                ForEach(viewModel.products, id: \.id) { product in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading) {
                            Text(product.displayName)
                                .font(.headline)
                            Text(product.description)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Text(product.displayPrice)
                            .font(.headline)
                        Button(action: { Task { await viewModel.buy(product) } }) {
                            Text(viewModel.isProUnlocked ? "Purchased" : "Buy")
                        }
                        .disabled(viewModel.isProUnlocked)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.08)))
                }
            }

            HStack {
                Button("Restore Purchases") { Task { await viewModel.restore() } }
                Spacer()
            }
        }
        .padding(20)
        .task { await viewModel.load() }
        .frame(minWidth: 460)
    }
}

struct IAPView_Previews: PreviewProvider {
    static var previews: some View {
        IAPView()
    }
}


