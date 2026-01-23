import SwiftUI

struct GoodLinksSettingsView: View {
    @StateObject private var viewModel: GoodLinksSettingsViewModel
    @State private var isPickingGoodLinks: Bool = false

    @MainActor
    init(viewModel: GoodLinksSettingsViewModel? = nil) {
        if let viewModel {
            _viewModel = StateObject(wrappedValue: viewModel)
        } else {
            _viewModel = StateObject(wrappedValue: GoodLinksSettingsViewModel())
        }
    }

    var body: some View {
        List {
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
                    .scaledFont(.headline)
            }
            
            // MARK: - Content Fetching
            
            Section {
                Toggle(isOn: $viewModel.urlFetcherEnableCache) {
                    Text("Enable URL Fetch Cache")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Cache fetched article content for faster loading")
                .onChange(of: viewModel.urlFetcherEnableCache) { _, _ in
                    viewModel.save()
                }
                
                Toggle(isOn: $viewModel.urlFetcherEnableCookieAuth) {
                    Text("Use Site Login Cookies")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Attach Cookie header from Site Logins when available")
                .onChange(of: viewModel.urlFetcherEnableCookieAuth) { _, _ in
                    viewModel.save()
                }
                
                Toggle(isOn: $viewModel.urlFetcherEnableRetry) {
                    Text("Enable Retry (Backoff)")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Retry transient failures with exponential backoff")
                .onChange(of: viewModel.urlFetcherEnableRetry) { _, _ in
                    viewModel.save()
                }
                
                if viewModel.urlFetcherEnableRetry {
                    Stepper(value: $viewModel.urlFetcherMaxRetries, in: 0...10, step: 1) {
                        Text("Max Retries: \(viewModel.urlFetcherMaxRetries)")
                            .scaledFont(.body)
                    }
                    .help("Retries for transient errors (429/5xx/timeouts)")
                    .onChange(of: viewModel.urlFetcherMaxRetries) { _, _ in
                        viewModel.save()
                    }
                    
                    DisclosureGroup {
                        Stepper(value: $viewModel.urlFetcherInitialBackoffSeconds, in: 0.1...10.0, step: 0.5) {
                            Text("Initial Backoff: \(String(format: "%.1f", viewModel.urlFetcherInitialBackoffSeconds))s")
                                .scaledFont(.body)
                        }
                        .onChange(of: viewModel.urlFetcherInitialBackoffSeconds) { _, _ in
                            viewModel.save()
                        }
                        
                        Stepper(value: $viewModel.urlFetcherMaxBackoffSeconds, in: 0.5...60.0, step: 0.5) {
                            Text("Max Backoff: \(String(format: "%.1f", viewModel.urlFetcherMaxBackoffSeconds))s")
                                .scaledFont(.body)
                        }
                        .onChange(of: viewModel.urlFetcherMaxBackoffSeconds) { _, _ in
                            viewModel.save()
                        }
                    } label: {
                        Text("Retry Advanced")
                            .scaledFont(.body)
                    }
                }
            } header: {
                Text("Content Fetching")
                    .scaledFont(.headline)
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
