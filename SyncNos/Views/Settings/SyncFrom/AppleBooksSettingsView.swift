import SwiftUI

struct AppleBooksSettingsView: View {
    @StateObject private var viewModel = AppleBooksSettingsViewModel()
    @State private var isPickingBooks: Bool = false

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text(String(localized: "Enable Apple Books source", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Show Apple Books in the main list and commands", table: "Settings"))
                .onChange(of: viewModel.isSourceEnabled) { _, _ in
                    viewModel.save()
                }
            } header: {
                Text(String(localized: "Data Source", table: "Settings"))
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Sync Settings
            Section {
                Picker(selection: $viewModel.syncMode) {
                    Text(String(localized: "One page per book", table: "Settings"))
                        .scaledFont(.body)
                        .tag("single")
                    Text(String(localized: "One database per book", table: "Settings"))
                        .scaledFont(.body)
                        .tag("perBook")
                } label: {
                    Text(String(localized: "Sync Mode", table: "Settings"))
                        .scaledFont(.body)
                }
                .onChange(of: viewModel.syncMode) { _, _ in
                    viewModel.saveSyncMode()
                }

                LabeledContent {
                    TextField("Notion Database ID for Apple Books", text: $viewModel.appleBooksDbId)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: viewModel.appleBooksDbId) { _, _ in
                            viewModel.save()
                        }
                } label: {
                    Text(String(localized: "Database ID (optional)", table: "Settings"))
                        .scaledFont(.body)
                }

                Toggle(isOn: $viewModel.autoSync) {
                    Text(String(localized: "Smart Auto Sync", table: "Settings"))
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help(String(localized: "Sync every 5 minutes, only changed content", table: "Settings"))
                .onChange(of: viewModel.autoSync) { _, _ in
                    viewModel.save()
                }

                // Apple Books 数据目录授权按钮
                Button(action: {
                    guard !isPickingBooks else { return }
                    isPickingBooks = true
                    AppleBooksPicker.pickAppleBooksContainer()
                    // 延迟重置状态，防止快速重复点击
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        isPickingBooks = false
                    }
                }) {
                    HStack {
                        Label(String(localized: "Select Folder", table: "Common"), systemImage: "folder")
                            .scaledFont(.body)
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .scaledFont(.body)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                .help(String(localized: "Choose data folder and load notes", table: "Settings"))
            } header: {
                Text(String(localized: "Sync Settings", table: "Settings"))
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }

        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle(String(localized: "Apple Books", table: "Common"))
    }
}

struct AppleBooksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        AppleBooksSettingsView()
    }
}