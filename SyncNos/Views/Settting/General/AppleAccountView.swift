import SwiftUI
import AuthenticationServices

struct AppleAccountView: View {
    @StateObject private var appleViewModel = AppleSignInViewModel()
    @StateObject private var accountViewModel = AccountViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Apple Sign In (macOS)
                VStack {
                    SignInWithAppleButton(.signIn) { request in
                        appleViewModel.configure(request: request)
                    } onCompletion: { result in
                        appleViewModel.handle(completion: result)
                        switch result {
                        case .success:
                            if case .succeeded(let user) = appleViewModel.state, let code = user.authorizationCode, !code.isEmpty {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                    accountViewModel.loginWithApple(authorizationCode: code, nonce: appleViewModel.rawNonce)
                                }
                            } else {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                    accountViewModel.load()
                                }
                            }
                        case .failure:
                            break
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .cornerRadius(8)

                    Group {
                        switch appleViewModel.state {
                        case .idle:
                            HStack(spacing: 8) {
                                Image(systemName: "info.circle")
                                    .foregroundColor(.secondary)
                                Text("Click the button above to start authorization")
                                    .foregroundColor(.secondary)
                                    .font(.subheadline)
                            }
                        case .processing:
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Requesting authorization...")
                                    .font(.subheadline)
                            }
                        case .succeeded(let user):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Authorization successful")
                                    .font(.headline)
                                if let name = user.fullName, !name.isEmpty { Text("Name: \(name)") }
                                if let mail = user.email, !mail.isEmpty { Text("Email: \(mail)") }
                                Text("User Identifier：\(user.userIdentifier)")
                                    .font(.footnote)
                                    .foregroundColor(.secondary)
#if DEBUG
                                if let code = user.authorizationCode, !code.isEmpty {
                                    Text("authorization_code：\(code)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                                if let idt = user.identityToken, !idt.isEmpty {
                                    Text("identity_token：\(idt)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
#endif
                                Button("Reset status") { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        case .failed(let message):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Authorization failed").font(.headline)
                                Text(message).foregroundColor(.red).font(.subheadline)
                                Button("Retry") { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }

                Divider().padding(.vertical)

                // Account information
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("Account information").font(.title3).bold()
                        Spacer()
                        if accountViewModel.isLoading { ProgressView() }
                    }

                    if let err = accountViewModel.errorMessage {
                        Text(err).foregroundColor(.red).font(.footnote)
                    }

                    if let p = accountViewModel.profile {
                        GroupBox(label: Text("Basic information")) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("User ID: \(p.userId)")
                                if let name = p.displayName, !name.isEmpty { Text("Display name: \(name)") }
                                if let email = p.email, !email.isEmpty { Text("Email: \(email)") }
                                if let created = p.createdAt { Text("Creation time: \(created)").font(.footnote).foregroundColor(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        Text("User information not loaded").foregroundColor(.secondary)
                    }

                    GroupBox(label: Text("Login methods")) {
                        if accountViewModel.loginMethods.isEmpty {
                            Text("None").foregroundColor(.secondary)
                        } else {
                            ForEach(Array(accountViewModel.loginMethods.enumerated()), id: \.0) { _, m in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(m.providerName)").bold()
                                    Text("key: \(m.providerKey)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        Button("Refresh information") { accountViewModel.load() }
                            .buttonStyle(.bordered)
                        Button("Sign out") { accountViewModel.logout() }
                            .buttonStyle(.bordered)
                        Button("Delete account") { accountViewModel.deleteAccount() }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Apple Account & Sign In")
        .onAppear { accountViewModel.load() }
    }
}

struct AppleAccountView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView { AppleAccountView() }
    }
}