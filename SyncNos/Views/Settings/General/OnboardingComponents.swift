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
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
            .id(viewModel.currentStep) // Force transition on step change
        }
        .frame(width: 600, height: 500) // Fixed size for onboarding window
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
            (icon: "message", color: .green, angle: 198)
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
                            .scaledFont(.title2, weight: .bold)
                            .foregroundStyle(Color("OnboardingTextColor"))

                        Text("Sync Apple Books, GoodLinks, WeRead, Dedao, and Chats highlights directly to your Notion database.")
                            .scaledFont(.subheadline)
                            .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()

                    // 右箭头按钮
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
    private var subtitleFontSize: CGFloat { 24 * fontScaleManager.scaleFactor }

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
                        .font(.system(size: subtitleFontSize, weight: .bold))
                        .foregroundStyle(Color("OnboardingTextColor"))
                }

                Text(viewModel.workspaceName ?? "Workspace")
                    .scaledFont(.subheadline)
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
                    .font(.system(size: subtitleFontSize, weight: .bold))
                    .foregroundStyle(Color("OnboardingTextColor"))

                Text("We'll create secure databases in your Notion workspace.")
                    .scaledFont(.subheadline)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                    .lineLimit(2)

                if let error = viewModel.notionErrorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                        .scaledFont(.caption)
                }
            }

            Spacer()

            // Skip 按钮
            Button("Skip") {
                viewModel.nextStep()
            }
            .buttonStyle(.link)
            .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))

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
                ForEach(ContentSource.allCases, id: \.self) { source in
                    sourceCardView(for: source)
                }
            }
            .padding(.horizontal, 40)

            Spacer()

            // 错误提示
            if let error = viewModel.sourceSelectionError {
                Text(error)
                    .scaledFont(.caption)
                    .foregroundStyle(.red)
                    .padding(.bottom, 8)
            }

            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Enable your datasources")
                        .scaledFont(.title2, weight: .bold)
                        .foregroundStyle(Color("OnboardingTextColor"))

                    Text("Select at least one source to sync your highlights: Apple Books, GoodLinks, WeRead, Dedao, and Chats.")
                        .scaledFont(.subheadline)
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

    @ViewBuilder
    private func sourceCardView(for source: ContentSource) -> some View {
        if source == .weRead {
            SourceCard(
                icon: onboardingIconName(for: source),
                color: source.accentColor,
                title: source.title,
                isOn: binding(for: source)
            )
            .onChange(of: viewModel.weReadEnabled) { _, newValue in
                if newValue && !viewModel.isWeReadLoggedIn {
                    // We could show a tip here
                }
            }
        } else {
            SourceCard(
                icon: onboardingIconName(for: source),
                color: source.accentColor,
                title: source.title,
                isOn: binding(for: source)
            )
        }
    }

    private func binding(for source: ContentSource) -> Binding<Bool> {
        switch source {
        case .appleBooks:
            return $viewModel.appleBooksEnabled
        case .goodLinks:
            return $viewModel.goodLinksEnabled
        case .weRead:
            return $viewModel.weReadEnabled
        case .dedao:
            return $viewModel.dedaoEnabled
        case .chats:
            return $viewModel.chatsEnabled
        }
    }

    private func onboardingIconName(for source: ContentSource) -> String {
        source.icon
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

#Preview("Next Button") {
    OnboardingNextButton { }
        .padding()
        .background(Color("BackgroundColor"))
        .applyFontScale()
}
