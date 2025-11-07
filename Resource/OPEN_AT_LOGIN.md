# Open at Login — 技术文档

本文档仅针对项目中“Open at Login”（登录时打开）功能的实现细节、位置、使用和测试方法进行说明。**不包含任何后台 helper/后台活动相关内容**，项目已移除旧的 LoginHelper 实现并强制采用 macOS 13+ 的 `SMAppService.mainApp`。

## 版本说明
- 破坏性变更：项目已移除 legacy helper 与兼容代码，只支持 macOS 13+ 的 `SMAppService.mainApp`。

## 主要实现文件与职责

- `SyncNos/Services/Core/LoginItemService.swift` — 核心实现（注册/注销/查询）
  - 该服务直接使用 `SMAppService.mainApp` 提供的 API：`register()` / `unregister()` / `status`。
  - 责任：将“主应用”注册为系统的“登录时打开（Open at Login）”，以及查询该状态。

```1:23:SyncNos/Services/Core/LoginItemService.swift
import Foundation
import ServiceManagement

final class LoginItemService: LoginItemServiceProtocol {
    func isRegistered() -> Bool {
        // macOS 13+ only: reflect whether the main app is set to open at login
        return SMAppService.mainApp.status != .notRegistered
    }
```

```25:46:SyncNos/Services/Core/LoginItemService.swift
    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}
```

- `SyncNos/ViewModels/Settings/LoginItemViewModel.swift` — UI 与服务桥接
  - 用于呈现 Toggle 状态并调用 `LoginItemService.setEnabled(_)`，通过 `@Published var isEnabled` 与 UI 绑定。

```6:23:SyncNos/ViewModels/Settings/LoginItemViewModel.swift
final class LoginItemViewModel: ObservableObject {
    @Published var isEnabled: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let service: LoginItemServiceProtocol
    ...
    DispatchQueue.global(qos: .userInitiated).async {
        let registered = service.isRegistered()
        DispatchQueue.main.async {
            self.isEnabled = registered
        }
    }
```

```26:46:SyncNos/ViewModels/Settings/LoginItemViewModel.swift
    func setEnabled(_ enabled: Bool) {
        ...
        Task {
            do {
                try service.setEnabled(enabled)
                DispatchQueue.main.async {
                    self.isEnabled = enabled
                    self.isLoading = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isEnabled = self.service.isRegistered()
                    self.isLoading = false
                }
            }
        }
    }
}
```

- `SyncNos/Views/Settting/General/SettingsView.swift` — 用户设置界面
  - `Toggle` 绑定到 `LoginItemViewModel.isEnabled`，切换时调用 `setEnabled(_:)`。

```12:18:SyncNos/Views/Settting/General/SettingsView.swift
                    Toggle(isOn: $loginItemVM.isEnabled) {
                        Label("Open at Login", systemImage: "arrow.up.right.square")
                    }
                    .toggleStyle(SwitchToggleStyle())
                    .onChange(of: loginItemVM.isEnabled) { newValue in
                        loginItemVM.setEnabled(newValue)
                    }
```

- `SyncNos/Services/Core/DIContainer.swift` — 服务注入点
  - 通过 `DIContainer.shared.loginItemService` 提供 `LoginItemService` 的实例。

```128:133:SyncNos/Services/Core/DIContainer.swift
    var loginItemService: LoginItemServiceProtocol {
        if _loginItemService == nil {
            _loginItemService = LoginItemService()
        }
        return _loginItemService!
    }
```

## 设计说明（工作流）
1. 应用启动时，界面/视图模型从 `loginItemService.isRegistered()` 异步读取当前状态并在 UI 上呈现。
2. 用户在设置中切换 `Open at Login`：`LoginItemViewModel.setEnabled(_:)` 调用 `LoginItemService.setEnabled(_:)`。
3. `LoginItemService` 在 macOS 13+ 下调用 `SMAppService.mainApp.register()` 或 `unregister()` 完成系统注册/注销；可能触发系统安全提示。

## 平台与兼容性
- 仅支持 macOS 13+（Ventura 及更高）。项目已删除对旧 API（例如 `SMLoginItemSetEnabled` 或辅助 helper）的兼容实现。

## 测试与验证步骤
1. 构建并运行应用（目标：macOS 13 及以上）。
2. 打开 应用 → Settings → General，切换 `Open at Login`：
   - 开启：系统设置（System Settings → General → Login Items）应显示 `SyncNos` 在“登录时打开（Open at Login）”列表中；重启登录后应用随登录启动。
   - 关闭：从系统“登录时打开”列表中移除 `SyncNos`。若用户手动在系统设置中禁止，应用的 `isRegistered()` 会反映出真实状态。
3. 若需要，使用 `SMAppService.openSystemSettingsLoginItems()` 打开系统“登录项”设置（可考虑在设置页增加按钮触发该调用）。

## 风险与注意事项
- 破坏性变更已移除所有 legacy helper：如果存在旧版安装残留的后台 helper 条目，需要用户或脚本手动清理系统登录项（但项目构建/发行中不再包含 helper）。
- 系统行为：`SMAppService.mainApp.register()` 的用户体验（提示、权限）由 macOS 控制，具体表现随系统版本和用户设置而异。
- 发布说明：务必在发行说明/最小系统要求中明确标注 macOS 13+。

## 扩展建议（可选）
- 在设置页添加一个“打开系统登录项设置”的按钮，调用：
  ```swift
  if #available(macOS 13.0, *) {
      SMAppService.openSystemSettingsLoginItems()
  }
  ```
- 如果需要集中管理迁移或清理旧用户残留条目，可编写单次迁移脚本，但这超出本仓库当前破坏性策略范围。

文档作者：SyncNos 源代码维护团队
