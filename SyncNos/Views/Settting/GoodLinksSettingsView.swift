import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel = GoodLinksSettingsViewModel()

    var body: some View {
        List {
            Section(header: Label("GoodLinks - Sync Settings", systemImage: "bookmark")) {
                LabeledContent("Database ID (optional)") {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                }

                Toggle("Auto Sync (placeholder)", isOn: $viewModel.autoSync)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .help("GoodLinks auto-sync not implemented; this is a UI-only toggle for now")

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
        .navigationTitle("GoodLinks Settings")
    }
}

struct GoodLinksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksSettingsView()
    }
}