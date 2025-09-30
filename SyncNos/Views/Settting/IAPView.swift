import SwiftUI
import StoreKit

struct IAPView: View {
    @StateObject private var viewModel = IAPViewModel()

    var body: some View {
        List {
            Section(header: Text("Status")) {
                HStack {
                    Text("Pro Unlocked")
                    Spacer()
                    Image(systemName: viewModel.isProUnlocked ? "checkmark.seal.fill" : "xmark.seal")
                        .foregroundColor(viewModel.isProUnlocked ? .green : .secondary)
                }
            }

            Section(header: Text("Products")) {
                if viewModel.isLoading {
                    ProgressView()
                } else if viewModel.products.isEmpty {
                    Text("No products found.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.products, id: \.id) { product in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(product.displayName)
                                Text(product.displayPrice)
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                            Spacer()
                            Button("Buy") {
                                viewModel.buy(product: product)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isProUnlocked)
                        }
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
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Support the Project")
        .onAppear { viewModel.onAppear() }
    }
}

struct IAPView_Previews: PreviewProvider {
    static var previews: some View {
        IAPView()
    }
}


