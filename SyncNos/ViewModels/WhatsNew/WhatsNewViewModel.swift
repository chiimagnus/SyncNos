//
//  WhatsNewViewModel.swift
//  SyncNos
//
//  Created by Chii on 2025/12/13.
//

import SwiftUI
import Combine

// MARK: - WhatsNewViewModel

/// 管理 What's New 功能的 ViewModel
@MainActor
final class WhatsNewViewModel: ObservableObject {
    
    // MARK: - 存储键
    private static let lastSeenVersionKey = "WhatsNew.LastSeenVersion"
    private static let lastSeenBuildKey = "WhatsNew.LastSeenBuild"
    
    // MARK: - Published Properties
    @Published var versions: [WhatsNewVersion] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var showHistory = false
    
    // MARK: - Dependencies
    private let dataSource: WhatsNewDataSource
    private let logger: LoggerServiceProtocol
    
    // MARK: - 版本信息
    
    /// 获取当前 App 版本号
    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }
    
    /// 获取当前构建号
    static var currentBuild: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
    
    /// 版本号 + 构建号组合显示
    static var versionBuild: String {
        "\(currentVersion) (\(currentBuild))"
    }
    
    // MARK: - Initialization
    
    init(
        dataSource: WhatsNewDataSource = .default,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.dataSource = dataSource
        self.logger = logger
    }
    
    // MARK: - 版本比较
    
    /// 检查是否需要显示 What's New
    /// - Returns: 如果版本或构建号发生变化则返回 true
    static func shouldShowWhatsNew() -> Bool {
        let savedVersion = UserDefaults.standard.string(forKey: lastSeenVersionKey) ?? ""
        let savedBuild = UserDefaults.standard.string(forKey: lastSeenBuildKey) ?? ""
        
        let isNewVersion = savedVersion != currentVersion
        let isNewBuild = savedBuild != currentBuild
        
        return isNewVersion || isNewBuild
    }
    
    /// 标记当前版本已查看
    func markAsSeen() {
        UserDefaults.standard.set(Self.currentVersion, forKey: Self.lastSeenVersionKey)
        UserDefaults.standard.set(Self.currentBuild, forKey: Self.lastSeenBuildKey)
        logger.info("[WhatsNew] Marked version \(Self.versionBuild) as seen")
    }
    
    /// 重置版本记录（用于测试或强制显示）
    static func reset() {
        UserDefaults.standard.removeObject(forKey: lastSeenVersionKey)
        UserDefaults.standard.removeObject(forKey: lastSeenBuildKey)
    }
    
    // MARK: - 数据加载
    
    /// 加载 What's New 数据
    func loadData() async {
        isLoading = true
        errorMessage = nil
        
        do {
            switch dataSource {
            case .local(let fileName):
                versions = try await loadFromBundle(fileName: fileName)
            case .remote(let url):
                versions = try await loadFromURL(url)
            }
            logger.info("[WhatsNew] Loaded \(versions.count) versions")
        } catch {
            errorMessage = error.localizedDescription
            logger.error("[WhatsNew] Failed to load data: \(error.localizedDescription)")
        }
        
        isLoading = false
    }
    
    /// 从 Bundle 中加载本地 JSON 文件
    private func loadFromBundle(fileName: String) async throws -> [WhatsNewVersion] {
        guard let url = Bundle.main.url(forResource: fileName, withExtension: "json") else {
            throw WhatsNewError.fileNotFound
        }
        
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode([WhatsNewVersion].self, from: data)
    }
    
    /// 从远程 URL 加载 JSON 数据
    private func loadFromURL(_ urlString: String) async throws -> [WhatsNewVersion] {
        guard let url = URL(string: urlString) else {
            throw WhatsNewError.invalidURL
        }
        
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode([WhatsNewVersion].self, from: data)
    }
    
    // MARK: - 计算属性
    
    /// 获取当前版本的更新项
    var currentVersionItems: [WhatsNewItem] {
        let currentVersion = Self.currentVersion
        
        // 优先匹配完整版本号，其次匹配 subVersion
        if let matchedVersion = versions.first(where: {
            $0.version == currentVersion || $0.subVersion == currentVersion
        }) {
            return matchedVersion.items
        }
        
        // 如果没有匹配，返回最新版本（第一个）
        return versions.first?.items ?? []
    }
    
    /// 当前版本是否有更新内容
    var hasContent: Bool {
        !currentVersionItems.isEmpty
    }
}

