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
                                    .scaledFont(.subheadline)
                            }
                        case .processing:
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Requesting authorization...")
                                    .scaledFont(.subheadline)
                            }
                        case .succeeded(let user):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Authorization successful")
                                    .scaledFont(.headline)
                                if let name = user.fullName, !name.isEmpty { Text("Name: \(name)").scaledFont(.body) }
                                if let mail = user.email, !mail.isEmpty { Text("Email: \(mail)").scaledFont(.body) }
                                Text("User Identifier：\(user.userIdentifier)")
                                    .scaledFont(.footnote)
                                    .foregroundColor(.secondary)
#if DEBUG
                                if let code = user.authorizationCode, !code.isEmpty {
                                    Text("authorization_code：\(code)")
                                        .scaledFont(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                                if let idt = user.identityToken, !idt.isEmpty {
                                    Text("identity_token：\(idt)")
                                        .scaledFont(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
#endif
                                Button("Reset status") { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        case .failed(let message):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Authorization failed").scaledFont(.headline)
                                Text(message).foregroundColor(.red).scaledFont(.subheadline)
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
                        Text("Account information").scaledFont(.title3, weight: .bold)
                        Spacer()
                        if accountViewModel.isLoading { ProgressView() }
                    }

                    if let err = accountViewModel.errorMessage {
                        Text(err).foregroundColor(.red).scaledFont(.footnote)
                    }

                    if let p = accountViewModel.profile {
                        GroupBox(label: Text("Basic information")) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("User ID: \(p.userId)").scaledFont(.body)
                                if let name = p.displayName, !name.isEmpty { Text("Display name: \(name)").scaledFont(.body) }
                                if let email = p.email, !email.isEmpty { Text("Email: \(email)").scaledFont(.body) }
                                if let created = p.createdAt { Text("Creation time: \(created)").scaledFont(.footnote).foregroundColor(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        Text("User information not loaded").foregroundColor(.secondary).scaledFont(.body)
                    }

                    GroupBox(label: Text("Login methods")) {
                        if accountViewModel.loginMethods.isEmpty {
                            Text("None").foregroundColor(.secondary).scaledFont(.body)
                        } else {
                            ForEach(Array(accountViewModel.loginMethods.enumerated()), id: \.0) { _, m in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(m.providerName)").bold().scaledFont(.body)
                                    Text("key: \(m.providerKey)")
                                        .scaledFont(.footnote)
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
            .applyFontScale()
    }
}
