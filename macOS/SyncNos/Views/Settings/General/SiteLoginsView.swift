import SwiftUI

/// 站点登录管理（用于需要 Cookie 才能抓取的网页）
///
struct SiteLoginsView: View {
    @StateObject private var viewModel = SiteLoginsViewModel()
    
    @State private var showingWeReadLoginSheet: Bool = false
    @State private var showingDedaoLoginSheet: Bool = false
    @State private var showingGoodLinksLoginSheet: Bool = false
    
    var body: some View {
        List {
            Section {
                LabeledContent {
                    Text(viewModel.domains.isEmpty ? "0" : "\(viewModel.domains.count)")
                        .scaledFont(.body)
                        .foregroundColor(viewModel.domains.isEmpty ? .secondary : .green)
                } label: {
                    Label("Saved Logins", systemImage: viewModel.domains.isEmpty ? "xmark.seal" : "checkmark.seal.fill")
                        .scaledFont(.body)
                }
            } footer: {
                Text("These cookies are used to fetch content from websites that require login.")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
            
            Section {
                if viewModel.domains.isEmpty {
                    Text("No sites")
                        .scaledFont(.body)
                        .foregroundColor(.secondary)
                } else {
                    ForEach(viewModel.domains) { entry in
                        domainRow(entry)
                    }
                }
            } header: {
                Text("Domains")
                    .scaledFont(.headline)
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Site Logins")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    viewModel.refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                
                Menu {
                    Button {
                        showingWeReadLoginSheet = true
                    } label: {
                        Text("WeRead")
                    }
                    
                    Button {
                        showingDedaoLoginSheet = true
                    } label: {
                        Text("Dedao")
                    }
                    
                    Button {
                        showingGoodLinksLoginSheet = true
                    } label: {
                        Text("Custom URL")
                    }
                } label: {
                    Label("Open Login", systemImage: "safari")
                }
                
                Button(role: .destructive) {
                    viewModel.clearAll()
                } label: {
                    Text("Clear All")
                }
                .disabled(viewModel.domains.isEmpty)
            }
        }
        .onAppear { viewModel.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: .siteLoginsShowLoginSheet).receive(on: DispatchQueue.main)) { notification in
            guard let sourceRaw = notification.userInfo?["source"] as? String,
                  let source = ContentSource(rawValue: sourceRaw) else { return }
            openLogin(for: source)
        }
        .sheet(isPresented: $showingWeReadLoginSheet) {
            WeReadLoginView {
                viewModel.refresh()
            }
        }
        .sheet(isPresented: $showingDedaoLoginSheet) {
            DedaoLoginView(onLoginChanged: {
                viewModel.refresh()
            })
        }
        .sheet(isPresented: $showingGoodLinksLoginSheet) {
            GoodLinksLoginView {
                viewModel.refresh()
            }
        }
    }
    
    // MARK: - Helpers
    
    private func domainRow(_ entry: SiteLoginsDomainEntry) -> some View {
        LabeledContent {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text("Updated \(format(entry.updatedAt))")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                    
                    Button(role: .destructive) {
                        viewModel.clear(domain: entry.domain)
                    } label: {
                        Text("Clear")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                Text(entry.cookieHeader)
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
        } label: {
            Text(entry.domain)
                .scaledFont(.body)
        }
    }
    
    private func openLogin(for source: ContentSource) {
        switch source {
        case .weRead:
            showingWeReadLoginSheet = true
        case .dedao:
            showingDedaoLoginSheet = true
        case .goodLinks:
            showingGoodLinksLoginSheet = true
        default:
            break
        }
    }
    
    private func format(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.locale = Locale(identifier: "zh_CN")
        return formatter.string(from: date)
    }
}

struct SiteLoginsView_Previews: PreviewProvider {
    static var previews: some View {
        SiteLoginsView()
    }
}
