import SwiftUI

struct AppleBooksSettingsView: View {
    @StateObject private var viewModel = AppleBooksSettingsViewModel()
    @State private var isPickingBooks: Bool = false

    var body: some View {
        List {
            // MARK: - Data Source
            Section {
                Toggle(isOn: $viewModel.isSourceEnabled) {
                    Text("Enable Apple Books source")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Show Apple Books in the main list and commands")
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
                Picker(selection: $viewModel.syncMode) {
                    Text("One page per book")
                        .scaledFont(.body)
                        .tag("single")
                    Text("One database per book")
                        .scaledFont(.body)
                        .tag("perBook")
                } label: {
                    Text("Sync Mode")
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
        .navigationTitle("Apple Books")
    }
}

struct AppleBooksSettingsView_Previews: PreviewProvider {
    static var previews: some View {
        AppleBooksSettingsView()
    }
}