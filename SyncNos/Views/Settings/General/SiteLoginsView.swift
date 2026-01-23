import SwiftUI

/// 站点登录管理（用于需要 Cookie 才能抓取的网页）
///
/// 当前用途：
/// - GoodLinks URL 抓取：当站点需要登录时，通过这里保存 cookies 以便后续请求携带 Cookie Header。
struct SiteLoginsView: View {
    @StateObject private var goodLinksLoginViewModel = GoodLinksLoginViewModel()
    @State private var showingGoodLinksLoginSheet: Bool = false
    
    var body: some View {
        List {
            Section {
                LabeledContent {
                    Text(goodLinksLoginViewModel.domainSummaries.isEmpty ? "Not Logged In" : "\(goodLinksLoginViewModel.domainSummaries.count) sites")
                        .scaledFont(.body)
                        .foregroundColor(goodLinksLoginViewModel.domainSummaries.isEmpty ? .secondary : .green)
                } label: {
                    Label("Login Status", systemImage: goodLinksLoginViewModel.domainSummaries.isEmpty ? "xmark.seal" : "checkmark.seal.fill")
                        .scaledFont(.body)
                }
                
                LabeledContent {
                    Button(role: .destructive) {
                        Task {
                            await goodLinksLoginViewModel.logout()
                        }
                    } label: {
                        Text("Clear All")
                            .scaledFont(.body)
                    }
                    .disabled(goodLinksLoginViewModel.domainSummaries.isEmpty)
                } label: {
                    Button {
                        showingGoodLinksLoginSheet = true
                    } label: {
                        Label("Open Login", systemImage: "safari")
                            .scaledFont(.body)
                    }
                }
                
                if !goodLinksLoginViewModel.domainSummaries.isEmpty {
                    ForEach(goodLinksLoginViewModel.domainSummaries) { item in
                        LabeledContent {
                            HStack(spacing: 10) {
                                Text("\(item.cookieCount) cookies")
                                    .scaledFont(.caption)
                                    .foregroundColor(.secondary)
                                
                                if item.hasSessionCookies {
                                    Text("Session")
                                        .scaledFont(.caption)
                                        .foregroundColor(.secondary)
                                } else if let exp = item.earliestExpiry {
                                    Text("Expires \(format(exp))")
                                        .scaledFont(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                Button(role: .destructive) {
                                    goodLinksLoginViewModel.clearDomain(item.domain)
                                } label: {
                                    Text("Clear")
                                        .scaledFont(.caption)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        } label: {
                            Text(item.domain)
                                .scaledFont(.body)
                        }
                    }
                }
            } footer: {
                Text("These cookies are used to fetch articles from websites that require login.")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .listStyle(SidebarListStyle())
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Site Logins")
        .onAppear {
            goodLinksLoginViewModel.refreshState()
        }
        .sheet(isPresented: $showingGoodLinksLoginSheet) {
            GoodLinksLoginView(viewModel: goodLinksLoginViewModel) {
                goodLinksLoginViewModel.refreshState()
            }
        }
    }
    
    // MARK: - Helpers
    
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

