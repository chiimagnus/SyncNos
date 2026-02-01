import SwiftUI

// MARK: - Onboarding Views

struct OnboardingView: View {
    @StateObject private var viewModel = OnboardingViewModel()

    var body: some View {
        VStack {
            // Content with transition
            Group {
                switch viewModel.currentStep {
                case .welcome:
                    OnboardingWelcomeView(viewModel: viewModel)
                case .connectNotion:
                    OnboardingNotionView(viewModel: viewModel)
                case .enableSources:
                    OnboardingSourcesView(viewModel: viewModel)
                case .touchMe:
                    OnboardingTouchMeView(viewModel: viewModel)
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
            .id(viewModel.currentStep) // Force transition on step change
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity) // 填满整个窗口
        .background(Color("BackgroundColor"))
    }
}

// MARK: - Step 1: Welcome

struct OnboardingWelcomeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    private var logoSize: CGFloat { 180 * fontScaleManager.scaleFactor }
    private var satelliteIconSize: CGFloat { 20 * fontScaleManager.scaleFactor }
    private var satelliteIconPadding: CGFloat { 12 * fontScaleManager.scaleFactor }
    private var orbitRadius: CGFloat { 120 * fontScaleManager.scaleFactor }
    private var satelliteSources: [(icon: String, color: Color, angle: Double)] {
        [
            (icon: "book", color: Color("BrandAppleBooks"), angle: -90),
            (icon: "bookmark", color: Color("BrandGoodLinks"), angle: -18),
            (icon: "w.square", color: Color("BrandWeRead"), angle: 54),
            (icon: "d.square", color: Color("BrandDedao"), angle: 126),
            (icon: "message", color: Color("BrandChat"), angle: 198)
        ]
    }

    var body: some View {
        ZStack {
            // Logo Cluster - 整个视图的正中央（水平+垂直居中）
            ZStack {
                Image("HeaderCard")
                    .resizable()
                    .scaledToFit()
                    .shadow(radius: 6)
                    .frame(width: logoSize, height: logoSize)

                // Satellite Icons
                ForEach(Array(satelliteSources.enumerated()), id: \.offset) { _, source in
                    satelliteIcon(source.icon, color: source.color, angle: source.angle)
                }
            }

            // 底部区域 - 文字 + 箭头按钮
            VStack {
                Spacer()

                HStack(alignment: .center, spacing: 20) {
                    // 文字部分
                    VStack(alignment: .leading, spacing: 8) {
                        Text("All your highlights, unified.")
                            .scaledFont(.title, weight: .bold)
                            .foregroundStyle(Color("OnboardingTextColor"))

                        Text("Sync Apple Books, GoodLinks, WeRead, Dedao, and Chats highlights directly to your Notion database.")
                            .scaledFont(.callout)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()

                    // 右箭头按钮π
                    OnboardingNextButton {
                        viewModel.nextStep()
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
        }
    }

    private func satelliteIcon(_ systemName: String, color: Color, angle: Double) -> some View {
        Image(systemName: systemName)
            .font(.system(size: satelliteIconSize))
            .foregroundStyle(.white)
            .padding(satelliteIconPadding)
            .background(color)
            .clipShape(Circle())
            .shadow(radius: 4)
            .offset(x: orbitRadius * cos(angle * .pi / 180), y: orbitRadius * sin(angle * .pi / 180))
    }
}

// MARK: - Step 2: Connect Notion

struct OnboardingNotionView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    private var notionIconSize: CGFloat { 120 * fontScaleManager.scaleFactor }

    var body: some View {
        VStack {
            Spacer()

            // 中央区域 - Notion 图标 + 标题
            HStack(spacing: 16) {
                Image(systemName: "n.square") // Notion
                    .font(.system(size: notionIconSize))
                    .foregroundStyle(Color("OnboardingTextColor"))

                Text("Notion OAuth")
                    .scaledFont(.largeTitle, weight: .bold)
                    .foregroundStyle(Color("OnboardingTextColor"))
                    .multilineTextAlignment(.leading)
            }

            Spacer()

            // 底部区域
            if viewModel.isNotionConnected {
                // 已连接状态
                connectedStateView
            } else {
                // 未连接状态
                disconnectedStateView
            }
        }
    }

    // MARK: - Connected State

    private var connectedStateView: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color("OnboardingButtonColor"))
                    Text("Connected")
                        .scaledFont(.title, weight: .bold)
                        .foregroundStyle(Color("OnboardingTextColor"))
                }

                Text(viewModel.workspaceName ?? "Workspace")
                    .scaledFont(.callout)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
            }

            Spacer()

            OnboardingNextButton {
                viewModel.nextStep()
            }
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
    }

    // MARK: - Disconnected State

    private var disconnectedStateView: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect Your Notion")
                    .scaledFont(.title, weight: .bold)
                    .foregroundStyle(Color("OnboardingTextColor"))

                Text("We'll create secure databases in your Notion workspace.")
                    .scaledFont(.callout)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                    .lineLimit(2)

                if let error = viewModel.notionErrorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                        .scaledFont(.callout)
                }
            }

            Spacer()

            // Skip 按钮
            Button("Skip") {
                viewModel.nextStep()
            }
            .buttonStyle(.link)
            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
            // .scaledFont(.callout)

            // 连接按钮
            Button(action: { viewModel.connectNotion() }) {
                HStack(spacing: 8) {
                    if viewModel.isAuthorizingNotion {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Connect")
                            .scaledFont(.headline)
                    }
                }
                .foregroundColor(.white)
                .frame(width: 100, height: 44)
                .background(Color("OnboardingButtonColor"))
                .cornerRadius(22)
                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isAuthorizingNotion)
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
    }
}

// MARK: - Step 3: Enable Sources

struct OnboardingSourcesView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    var body: some View {
        VStack {
            Spacer()

            // 中央区域 - 数据源卡片网格（确保完整展示所有已支持数据源）
            LazyVGrid(
                columns: sourceGridColumns,
                alignment: .center,
                spacing: fontScaleManager.isAccessibilitySize ? 16 : 20
            ) {
                ForEach(viewModel.onboardingProviders, id: \.source) { provider in
                    sourceCardView(for: provider)
                }
            }
            .padding(.horizontal, 40)

            Spacer()

            // 错误提示
            if let error = viewModel.sourceSelectionError {
                Text(error)
                    .scaledFont(.callout)
                    .foregroundStyle(.red)
                    .padding(.bottom, 8)
            }

            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Enable your datasources")
                        .scaledFont(.title, weight: .bold)
                        .foregroundStyle(Color("OnboardingTextColor"))

                    Text("Select at least one source to sync your highlights: Apple Books, GoodLinks, WeRead, Dedao, and Chats.")
                        .scaledFont(.callout)
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                OnboardingNextButton {
                    viewModel.nextStep()
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
    }

    private var sourceGridColumns: [GridItem] {
        if fontScaleManager.isAccessibilitySize {
            return [GridItem(.flexible())]
        }

        return [GridItem(.adaptive(minimum: 140 * fontScaleManager.scaleFactor), spacing: 24)]
    }

    private func sourceCardView(for provider: any DataSourceUIProvider) -> some View {
        SourceCard(
            icon: provider.iconName,
            color: provider.brandColor,
            title: provider.displayName,
            isOn: viewModel.enabledBinding(for: provider)
        )
    }
}

// MARK: - Step 4: Touch Me

struct OnboardingTouchMeView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    @Environment(\.openURL) private var openURL

    private let avatarImageName = "AuthorAvatar"
    private let githubURLString = "https://github.com/chiimagnus/SyncNos"

    private var avatarSize: CGFloat { 160 * fontScaleManager.scaleFactor }

    var body: some View {
        ZStack {
            // 中间：头像（更大）
            VStack(spacing: 16) {
                HStack(spacing: 20) {
                    Image(avatarImageName)
                        .resizable()
                        .scaledToFill()
                        .frame(width: avatarSize, height: avatarSize)
                        .clipShape(Circle())

                    Text(aboutText)
                        .scaledFont(.title2, weight: .bold)
                        .foregroundStyle(Color("OnboardingTextColor"))
                        .multilineTextAlignment(.leading)
//                        .lineLimit(fontScaleManager.isAccessibilitySize ? 4 : 3)
//                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // 底部：左下角文案 + 右下角下一步
            VStack {
                Spacer()

                HStack(alignment: .center, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Touch me")
                            .scaledFont(.title, weight: .bold)
                            .foregroundStyle(Color("OnboardingTextColor"))

                        Text("Feedback welcome.")
                            .scaledFont(.callout)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                    }

                    Spacer()

                    Button("Mail") {
                        openURL(mailtoURL)
                    }
                    .buttonStyle(.link)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                    // .scaledFont(.callout)

                    OnboardingNextButton {
                        viewModel.nextStep()
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
        }
    }

    private var aboutText: AttributedString {
        var text = AttributedString("I'm 𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼. \n\nSyncNos is open-source \non GitHub.")
        guard let url = URL(string: githubURLString),
              let range = text.range(of: "GitHub") else {
            return text
        }

        text[range].link = url
        text[range].foregroundColor = Color("OnboardingButtonColor")
        text[range].underlineStyle = .single
        return text
    }

    private var mailtoURL: URL {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = "chii_magnus@outlook.com"

        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let os = ProcessInfo.processInfo.operatingSystemVersionString

        let versionLine: String = {
            if !version.isEmpty && !build.isEmpty { return "\(version) (\(build))" }
            if !version.isEmpty { return version }
            if !build.isEmpty { return build }
            return "unknown"
        }()

        components.queryItems = [
            URLQueryItem(name: "subject", value: "[SyncNos] Feedback"),
            URLQueryItem(
                name: "body",
                value: """
App: SyncNos
Version: \(versionLine)
macOS: \(os)

Message:

"""
            )
        ]

        return components.url ?? URL(string: "mailto:chii_magnus@outlook.com")!
    }
}

// 统一的下一步圆形按钮
struct OnboardingNextButton: View {
    let action: () -> Void

    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    private var iconSize: CGFloat { 20 * fontScaleManager.scaleFactor }
    private var buttonSize: CGFloat { 50 * fontScaleManager.scaleFactor }

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.right")
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: buttonSize, height: buttonSize)
                .background(Color("OnboardingButtonColor"))
                .clipShape(Circle())
                .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 8, x: 0, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Next")
        // 添加 Large Content Viewer 支持
        .accessibilityShowsLargeContentViewer {
            Label("Next", systemImage: "arrow.right")
        }
    }
}

// Source Card
struct SourceCard: View {
    let icon: String
    let color: Color
    let title: String
    @Binding var isOn: Bool

    @ObservedObject private var fontScaleManager = FontScaleManager.shared

    private var iconSize: CGFloat { 32 * fontScaleManager.scaleFactor }
    private var iconContainerSize: CGFloat { 72 * fontScaleManager.scaleFactor }
    private var cardWidth: CGFloat { 120 * fontScaleManager.scaleFactor }

    var body: some View {
        VStack(spacing: 12) {
            // 图标
            Image(systemName: icon)
                .font(.system(size: iconSize))
                .foregroundStyle(.white)
                .frame(width: iconContainerSize, height: iconContainerSize)
                .background(color)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: color.opacity(0.3), radius: 8, x: 0, y: 4)

            // 标题
            Text(title)
                .scaledFont(.subheadline, weight: .medium)
                .foregroundStyle(Color("OnboardingTextColor"))

            // Toggle
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .controlSize(.mini)
                .labelsHidden()
        }
        .frame(minWidth: cardWidth)
    }
}

// Previews
#Preview("Onboarding") {
    OnboardingView()
}

#Preview("Welcome - Default") {
    OnboardingWelcomeView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}

#Preview("Notion - Disconnected") {
    OnboardingNotionView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}

#Preview("Sources - Default") {
    OnboardingSourcesView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}

#Preview("Touch Me - Default") {
    OnboardingTouchMeView(viewModel: OnboardingViewModel())
        .frame(width: 600, height: 500)
        .background(Color("BackgroundColor"))
        .applyFontScale()
}

#Preview("Next Button") {
    OnboardingNextButton { }
        .padding()
        .background(Color("BackgroundColor"))
        .applyFontScale()
}
