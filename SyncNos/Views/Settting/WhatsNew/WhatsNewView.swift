//
//  WhatsNewView.swift
//  SyncNos
//
//  Created by Chii on 2025/12/13.
//

import SwiftUI

// MARK: - What's New 主视图

/// 展示应用更新内容的主视图
/// 采用与 OnboardingView 和 PayWallView 一致的设计风格
struct WhatsNewView: View {
    
    // MARK: - Properties
    @StateObject private var viewModel = WhatsNewViewModel()
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    /// 完成回调
    var onFinish: (() -> Void)?
    
    // MARK: - Body
    
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            
            // 中央区域 - 头部 + 内容列表
            VStack(spacing: 20) {
                headerSection
                contentSection
            }
            
            Spacer()
            
            // 底部区域 - Onboarding 风格布局
            bottomSection
        }
        .frame(width: 600, height: 500)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("BackgroundColor"))
        .task {
            await viewModel.loadData()
        }
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        VStack(spacing: 12) {
            // App 图标
            if let appIcon = NSApp.applicationIconImage {
                Image(nsImage: appIcon)
                    .resizable()
                    .frame(width: 80, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
            }
            
            Text("What's New")
                .scaledFont(.largeTitle, weight: .bold)
                .foregroundStyle(Color("OnboardingTextColor"))
            
            Text("Version \(WhatsNewViewModel.versionBuild)")
                .scaledFont(.title3)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
        }
    }
    
    // MARK: - Content Section
    
    @ViewBuilder
    private var contentSection: some View {
        if viewModel.isLoading {
            loadingView
        } else if let error = viewModel.errorMessage {
            errorView(message: error)
        } else if viewModel.hasContent {
            scrollableContent
        } else {
            emptyView
        }
    }
    
    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .scaleEffect(1.2)
            Text("Loading...")
                .scaledFont(.subheadline)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
        }
        .frame(height: 200)
    }
    
    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(.orange)
            
            Text("Failed to load")
                .scaledFont(.headline)
                .foregroundStyle(Color("OnboardingTextColor"))
            
            Text(message)
                .scaledFont(.caption)
                .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                .multilineTextAlignment(.center)
            
            Button("Retry") {
                Task {
                    await viewModel.loadData()
                }
            }
            .buttonStyle(.bordered)
        }
        .frame(height: 200)
    }
    
    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 40))
                .foregroundStyle(Color("OnboardingButtonColor"))
            
            Text("No updates for this version")
                .scaledFont(.headline)
                .foregroundStyle(Color("OnboardingTextColor"))
        }
        .frame(height: 200)
    }
    
    private var scrollableContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 12) {
                ForEach(viewModel.currentVersionItems) { item in
                    WhatsNewItemRow(item: item)
                }
            }
            .padding(.horizontal, 60)
        }
        .frame(maxHeight: 250)
    }
    
    // MARK: - Bottom Section
    
    private var bottomSection: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Thanks for updating!")
                    .scaledFont(.title2, weight: .bold)
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Text("Check out what's new in this version.")
                    .scaledFont(.subheadline)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
            }
            
            Spacer()
            
            HStack(spacing: 12) {
                // 历史版本按钮（可选）
                if viewModel.versions.count > 1 {
                    Button {
                        viewModel.showHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Color("OnboardingTextColor").opacity(0.6))
                            .frame(width: 40, height: 40)
                            .background(Color("OnboardingCardColor").opacity(0.3))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help("View History")
                }
                
                // 继续按钮
                OnboardingNextButton {
                    viewModel.markAsSeen()
                    onFinish?()
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
        .sheet(isPresented: $viewModel.showHistory) {
            WhatsNewHistorySheet(viewModel: viewModel)
        }
    }
}

// MARK: - 更新项行视图

struct WhatsNewItemRow: View {
    let item: WhatsNewItem
    @ObservedObject private var fontScaleManager = FontScaleManager.shared
    
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // 图标
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color("OnboardingButtonColor").gradient)
                    .frame(width: 44, height: 44)
                
                Image(systemName: item.icon)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white)
            }
            .shadow(color: Color("OnboardingButtonColor").opacity(0.3), radius: 4, x: 0, y: 2)
            
            // 文字内容
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .scaledFont(.headline)
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Text(item.subtitle)
                    .scaledFont(.subheadline)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.7))
                
                Text(item.body)
                    .scaledFont(.caption)
                    .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                    .lineLimit(2)
            }
            
            Spacer()
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color("OnboardingCardColor").opacity(0.3))
        )
    }
}

// MARK: - 历史版本 Sheet

struct WhatsNewHistorySheet: View {
    @ObservedObject var viewModel: WhatsNewViewModel
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 0) {
            // 标题栏
            HStack {
                Text("Version History")
                    .scaledFont(.title2, weight: .bold)
                    .foregroundStyle(Color("OnboardingTextColor"))
                
                Spacer()
                
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color("OnboardingTextColor").opacity(0.5))
                }
                .buttonStyle(.plain)
            }
            .padding()
            
            Divider()
            
            // 版本列表
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    ForEach(viewModel.versions) { version in
                        VStack(spacing: 12) {
                            // 版本标签
                            HStack {
                                Text("v\(version.version)")
                                    .scaledFont(.headline, weight: .semibold)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 6)
                                    .background(Color("OnboardingButtonColor").opacity(0.2))
                                    .foregroundStyle(Color("OnboardingButtonColor"))
                                    .clipShape(Capsule())
                                
                                Spacer()
                            }
                            
                            // 更新项
                            ForEach(version.items) { item in
                                WhatsNewItemRow(item: item)
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .frame(width: 550, height: 500)
        .background(Color("BackgroundColor"))
    }
}

// MARK: - Previews

#Preview("What's New") {
    WhatsNewView()
}

#Preview("What's New - Loading") {
    WhatsNewView()
}

