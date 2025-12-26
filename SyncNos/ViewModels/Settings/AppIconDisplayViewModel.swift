import Foundation
import Combine
import AppKit

/// 管理应用图标显示模式的 ViewModel
@MainActor
final class AppIconDisplayViewModel: ObservableObject {
    // MARK: - Published Properties
    
    /// 当前选中的显示模式
    @Published var selectedMode: AppIconDisplayMode
    
    // MARK: - Private Properties
    
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Init
    
    init() {
        self.selectedMode = AppIconDisplayMode.current
        
        // 监听选择变化，自动应用
        $selectedMode
            .dropFirst() // 忽略初始值
            .removeDuplicates()
            .sink { [weak self] newMode in
                self?.applyDisplayMode(newMode)
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Public Methods
    
    /// 应用指定的显示模式
    func applyDisplayMode(_ mode: AppIconDisplayMode) {
        // 保存到 UserDefaults
        AppIconDisplayMode.current = mode
        
        // 应用 activation policy
        updateActivationPolicy(for: mode)
        
        // 发送通知，让 MenuBarExtra 根据需要显示/隐藏
        NotificationCenter.default.post(
            name: Notification.Name("AppIconDisplayModeChanged"),
            object: mode
        )
    }
    
    /// 在应用启动时调用，应用保存的设置
    /// 注意：必须在 NSApp 初始化完成后调用（如 applicationDidFinishLaunching）
    static func applyStoredMode() {
        let mode = AppIconDisplayMode.current
        updateActivationPolicyStatic(for: mode)
    }
    
    // MARK: - Private Methods
    
    private func updateActivationPolicy(for mode: AppIconDisplayMode) {
        Self.updateActivationPolicyStatic(for: mode)
    }
    
    private static func updateActivationPolicyStatic(for mode: AppIconDisplayMode) {
        // 确保 NSApp 已初始化
        guard let app = NSApp else {
            DIContainer.shared.loggerService.warning("NSApp not initialized, skipping activation policy update")
            return
        }
        
        let policy: NSApplication.ActivationPolicy
        
        switch mode {
        case .menuBarOnly:
            // 仅菜单栏：accessory 模式，不在 Dock 显示
            policy = .accessory
        case .dockOnly:
            // 仅 Dock：regular 模式，在 Dock 显示
            policy = .regular
        case .both:
            // 两者都显示：regular 模式
            policy = .regular
        }
        
        app.setActivationPolicy(policy)
        DIContainer.shared.loggerService.info("Applied activation policy: \(policy.rawValue) for mode: \(mode)")
    }
}

