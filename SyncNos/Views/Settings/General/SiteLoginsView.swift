import SwiftUI

/// 站点登录管理（用于需要 Cookie 才能抓取的网页）
///
struct SiteLoginsView: View {
    @StateObject private var viewModel = SiteLoginsViewModel()
    @StateObject private var goodLinksLoginViewModel = GoodLinksLoginViewModel()
    
    @State private var showingWeReadLoginSheet: Bool = false
    @State private var showingDedaoLoginSheet: Bool = false
    @State private var showingGoodLinksLoginSheet: Bool = false
    
    var body: some View {
        List {
            Section {
                LabeledContent {
                    Text(viewModel.entries.isEmpty ? "0" : "\(viewModel.entries.count)")
                        .scaledFont(.body)
                        .foregroundColor(viewModel.entries.isEmpty ? .secondary : .green)
                } label: {
                    Label("Saved Logins", systemImage: viewModel.entries.isEmpty ? "xmark.seal" : "checkmark.seal.fill")
                        .scaledFont(.body)
                }
            } footer: {
                Text("These cookies are used to fetch content from websites that require login.")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
            
            siteSection(source: .weRead)
            siteSection(source: .dedao)
            goodLinksSection()
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
                
                Button(role: .destructive) {
                    viewModel.clearAll()
                } label: {
                    Text("Clear All")
                }
                .disabled(viewModel.entries.isEmpty)
            }
        }
        .onAppear { viewModel.refresh() }
        .sheet(isPresented: $showingWeReadLoginSheet) {
            WeReadLoginView {
                viewModel.refresh()
            }
        }
        .sheet(isPresented: $showingDedaoLoginSheet) {
            DedaoLoginView(viewModel: DedaoLoginViewModel(
                authService: DIContainer.shared.dedaoAuthService,
                apiService: DIContainer.shared.dedaoAPIService
            )) {
                viewModel.refresh()
            }
        }
        .sheet(isPresented: $showingGoodLinksLoginSheet) {
            GoodLinksLoginView(viewModel: goodLinksLoginViewModel) {
                goodLinksLoginViewModel.refreshState()
                viewModel.refresh()
            }
        }
    }
    
    // MARK: - Helpers
    
    @ViewBuilder
    private func siteSection(source: ContentSource) -> some View {
        let entries = viewModel.entries.filter { $0.source == source }
        let entry = entries.first
        
        Section {
            if let entry {
                siteRow(entry)
            } else {
                Text("Not Configured")
                    .scaledFont(.body)
                    .foregroundColor(.secondary)
            }
        } header: {
            Text(source.displayName)
                .scaledFont(.headline)
        }
    }
    
    @ViewBuilder
    private func goodLinksSection() -> some View {
        let entries = viewModel.entries
            .filter { $0.source == .goodLinks }
            .sorted { ($0.domain ?? "") < ($1.domain ?? "") }
        
        Section {
            LabeledContent {
                Button {
                    showingGoodLinksLoginSheet = true
                } label: {
                    Label("Open Login", systemImage: "safari")
                        .scaledFont(.body)
                }
            } label: {
                Text("GoodLinks Web Login")
                    .scaledFont(.body)
            }
            
            if entries.isEmpty {
                Text("No sites")
                    .scaledFont(.body)
                    .foregroundColor(.secondary)
            } else {
                ForEach(entries) { entry in
                    goodLinksRow(entry)
                }
            }
        } header: {
            Text("GoodLinks")
                .scaledFont(.headline)
        }
    }
    
    private func siteRow(_ entry: SiteLoginEntry) -> some View {
        let status = viewModel.status(for: entry)
        return LabeledContent {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(statusText(status: status, fallbackIsLoggedIn: entry.isLoggedIn))
                        .scaledFont(.caption)
                        .foregroundColor(statusColor(status: status, fallbackIsLoggedIn: entry.isLoggedIn))
                    
                    Spacer()
                    
                    Button {
                        openLogin(for: entry.source)
                    } label: {
                        Text("Open Login")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    
                    Button {
                        viewModel.checkSession(for: entry)
                    } label: {
                        Text("Check")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    
                    Button(role: .destructive) {
                        viewModel.clear(entry)
                    } label: {
                        Text("Log Out")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                Text(entry.cookieHeader ?? "—")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
        } label: {
            Label("Login Status", systemImage: entry.isLoggedIn ? "checkmark.seal.fill" : "xmark.seal")
                .scaledFont(.body)
        }
    }
    
    private func goodLinksRow(_ entry: SiteLoginEntry) -> some View {
        let status = viewModel.status(for: entry)
        return LabeledContent {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(statusText(status: status, fallbackIsLoggedIn: entry.isLoggedIn))
                        .scaledFont(.caption)
                        .foregroundColor(statusColor(status: status, fallbackIsLoggedIn: entry.isLoggedIn))
                    
                    if let updatedAt = entry.updatedAt {
                        Text("Updated \(format(updatedAt))")
                            .scaledFont(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(role: .destructive) {
                        viewModel.clear(entry)
                    } label: {
                        Text("Clear")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                Text(entry.cookieHeader ?? "—")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
        } label: {
            Text(entry.domain ?? "Unknown Domain")
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
    
    private func statusText(status: SiteLoginStatus, fallbackIsLoggedIn: Bool) -> String {
        switch status {
        case .valid:
            return "Valid"
        case .unknown:
            return fallbackIsLoggedIn ? "Logged In (unchecked)" : "Not Logged In"
        case .expired:
            return "Expired"
        case .needLogin:
            return "Need Login"
        case .needVerification:
            return "Need Verification"
        }
    }
    
    private func statusColor(status: SiteLoginStatus, fallbackIsLoggedIn: Bool) -> Color {
        switch status {
        case .valid:
            return .green
        case .unknown:
            return fallbackIsLoggedIn ? .green : .secondary
        case .expired, .needLogin, .needVerification:
            return .secondary
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
