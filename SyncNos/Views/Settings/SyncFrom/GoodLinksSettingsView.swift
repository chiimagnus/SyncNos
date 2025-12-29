import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel = GoodLinksSettingsViewModel()
    @State private var isPickingGoodLinks: Bool = false

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text("Enable GoodLinks source")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Show GoodLinks in the main list and commands")
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text("Data Source")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Sync Settings
            Section {
                LabeledContent {
                    TextField("Notion Database ID for GoodLinks", text: $viewModel.goodLinksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.goodLinksDbId) { _, _ in
                            viewModel.save()
                        }
                } label: {
                    Text("Database ID (optional)")
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text("Smart Auto Sync")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Sync every 5 minutes, only changed content")
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }

                // GoodLinks 数据目录授权按钮
                Button(action: {
                    guard !isPickingGoodLinks else { return }
                    isPickingGoodLinks = true
                    GoodLinksPicker.pickGoodLinksFolder()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        isPickingGoodLinks = false
                    }
                }) {
                    HStack {
                        Label("Select Folder", systemImage: "folder")
                            .scaledFont(.body)
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .scaledFont(.body)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help("Choose data folder and load notes")
            } header: {
                Text("Sync Settings")
                    .font(.headline)
                    .foregroundStyle(.primary)
            }

            if let message = viewModel.message {
                Section {
                    Text(message)
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                }
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("GoodLinks")
    }
}

struct GoodLinksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        GoodLinksSettingsView()
    }
}