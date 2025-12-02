import SwiftUI
import WebKit

/// 得到登录视图（支持扫码登录）
struct DedaoLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: DedaoLoginViewModel
    
    let onLoginChanged: (() -> Void)?
    
    init(viewModel: DedaoLoginViewModel, onLoginChanged: (() -> Void)? = nil) {
        self.viewModel = viewModel
        self.onLoginChanged = onLoginChanged
    }
    
    var body: some View {
        VStack(spacing: 20) {
            // 标题
            Text("dedao.login.title")
                .font(.title2)
                .fontWeight(.semibold)
            
            // 状态信息
            Text(viewModel.statusMessage)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            // 二维码区域
            qrCodeSection
            
            // 操作按钮
            actionButtons
            
            Divider()
            
            // 手动输入 Cookie（备选方案）
            manualCookieSection
        }
        .padding(24)
        .frame(minWidth: 400, minHeight: 500)
        .onAppear {
            Task {
                await viewModel.startQRCodeLogin()
            }
        }
        .onDisappear {
            viewModel.stopPolling()
        }
        .onChange(of: viewModel.isLoggedIn) { _, newValue in
            if newValue {
                onLoginChanged?()
                dismiss()
            }
        }
    }
    
    // MARK: - QR Code Section
    
    @ViewBuilder
    private var qrCodeSection: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.windowBackgroundColor))
                .frame(width: 220, height: 220)
            
            switch viewModel.status {
            case .idle, .generatingQRCode:
                ProgressView()
                    .scaleEffect(1.5)
                
            case .waitingForScan:
                if let image = viewModel.qrCodeImage {
                    Image(nsImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 200, height: 200)
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "qrcode")
                            .font(.system(size: 60))
                            .foregroundColor(.secondary)
                        Text("dedao.login.qrCodeLoading")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
            case .scanned:
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.green)
                    Text("dedao.login.scanned")
                        .font(.headline)
                        .foregroundColor(.green)
                    Text("dedao.login.confirmOnPhone")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
            case .loginSuccess:
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.green)
                    Text("dedao.login.success")
                        .font(.headline)
                        .foregroundColor(.green)
                }
                
            case .loginFailed(let message):
                VStack(spacing: 8) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.red)
                    Text("dedao.login.failed")
                        .font(.headline)
                        .foregroundColor(.red)
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                
            case .qrCodeExpired:
                VStack(spacing: 8) {
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.system(size: 48))
                        .foregroundColor(.orange)
                    Text("dedao.login.qrCodeExpired")
                        .font(.headline)
                        .foregroundColor(.orange)
                }
            }
        }
    }
    
    // MARK: - Action Buttons
    
    @ViewBuilder
    private var actionButtons: some View {
        HStack(spacing: 12) {
            switch viewModel.status {
            case .qrCodeExpired, .loginFailed:
                Button {
                    Task {
                        await viewModel.refreshQRCode()
                    }
                } label: {
                    Label("dedao.login.refreshQRCode", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                
            case .loginSuccess:
                Button {
                    dismiss()
                } label: {
                    Label("done", systemImage: "checkmark")
                }
                .buttonStyle(.borderedProminent)
                
            default:
                Button {
                    Task {
                        await viewModel.refreshQRCode()
                    }
                } label: {
                    Label("dedao.login.refreshQRCode", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.status == .generatingQRCode)
            }
            
            Button(role: .cancel) {
                dismiss()
            } label: {
                Text("cancel")
            }
        }
    }
    
    // MARK: - Manual Cookie Section
    
    @ViewBuilder
    private var manualCookieSection: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Text("dedao.login.cookieHelp")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                TextEditor(text: $viewModel.manualCookie)
                    .font(.system(.caption, design: .monospaced))
                    .frame(height: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                    )
                
                Button {
                    viewModel.applyManualCookie()
                } label: {
                    Label("dedao.login.saveCookie", systemImage: "square.and.arrow.down")
                }
                .disabled(viewModel.manualCookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.top, 8)
        } label: {
            Label("dedao.login.manualCookie", systemImage: "doc.text")
                .font(.subheadline)
        }
    }
}

struct DedaoLoginView_Previews: PreviewProvider {
    static var previews: some View {
        DedaoLoginView(
            viewModel: DedaoLoginViewModel(
                authService: DIContainer.shared.dedaoAuthService,
                apiService: DIContainer.shared.dedaoAPIService
            )
        )
    }
}

