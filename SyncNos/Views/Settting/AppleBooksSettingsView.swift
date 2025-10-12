import SwiftUI

struct AppleBooksSettingsView: View {
    @StateObject private var viewModel = AppleBooksSettingsViewModel()

    var body: some View {
        List {
            Section(header: Text("Apple Books - Sync Settings")) {
                Picker("Sync Mode", selection: $viewModel.syncMode) {
                    Text("Single Database (One page per book)").tag("single")
                    Text("One database per book (Each highlight as an entry)").tag("perBook")
                }
                .onChange(of: viewModel.syncMode) { _ in
                    viewModel.saveSyncMode()
                }

                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for Apple Books", text: $viewModel.appleBooksDbId)
                        .textFieldStyle(.roundedBorder)
                }

                Toggle("Auto Sync (24 hours)", isOn: $viewModel.autoSync)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("Enable automatic sync for Apple Books (checked means AutoSyncService will run)")

                Button("Save") {
                    viewModel.save()
                }
                .buttonStyle(.borderedProminent)
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .foregroundColor(.secondary)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Apple Books Settings")
    }
}

struct AppleBooksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        AppleBooksSettingsView()
    }
}