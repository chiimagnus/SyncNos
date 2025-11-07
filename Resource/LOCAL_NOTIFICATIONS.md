# Local Notifications — 技术文档

本文档描述 SyncNos 中本地通知（local notifications）的实现、运行时行为、测试与排查步骤。文档同时说明项目并未在 Xcode 中勾选远程通知相关 Capability（即没有启用 Push / Time-Sensitive / Communication 的远程能力），并简要介绍这三类远程通知的用途与要求。

路径
- `Resource/LOCAL_NOTIFICATIONS.md`（本文件）

## 实现概述（SyncNos 当前行为）
- 目的：在用户切换设置（例如启/关 `Open at Login`）时，通过本地通知向用户反馈操作结果（开启/关闭成功）。
- 使用的 Apple API：`UserNotifications` 框架（`UNUserNotificationCenter` / `UNMutableNotificationContent` / `UNNotificationRequest`）。

## 关键代码位置
- 触发与调度本地通知：

```1:69:SyncNos/ViewModels/Settings/LoginItemViewModel.swift
    func setEnabled(_ enabled: Bool) {
        ...
        DispatchQueue.main.async {
            self.isEnabled = enabled
            self.isLoading = false
            // Deliver a local system notification to inform the user
            let title = enabled ? "Open at Login enabled" : "Open at Login disabled"
            let body = enabled ? "SyncNos will open automatically when you sign in." : "SyncNos will no longer open automatically at sign in."
            self.deliverSystemNotification(title: title, body: body)
        }
    }
```

```54:69:SyncNos/ViewModels/Settings/LoginItemViewModel.swift
    private func deliverSystemNotification(title: String, body: String) {
        let center = UNUserNotificationCenter.current()
        // Request authorization if needed, then schedule
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.5, repeats: false)
            let request = UNNotificationRequest(identifier: "syncnos.openAtLogin.", content: content, trigger: trigger)
            center.add(request, withCompletionHandler: nil)
        }
    }
```

- 前台展示与点击行为处理：`AppDelegate` 将 `UNUserNotificationCenter.current().delegate` 设置为自身，并实现代理方法以保证前台展示横幅，以及在通知被点击时将已有窗口置前而非创建新窗口：

```61:66:SyncNos/Infrastructure/AppDelegate.swift
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Present banner + sound even when app is foreground
        completionHandler([.banner, .sound, .list])
    }
```

```68:83:SyncNos/Infrastructure/AppDelegate.swift
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        // Handle notification tap: bring existing main window to front instead of creating a new one
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            if let w = NSApp.windows.first(where: { $0.isVisible }) {
                w.makeKeyAndOrderFront(nil)
            } else if let w = NSApp.windows.first {
                w.makeKeyAndOrderFront(nil)
            }
        }
        completionHandler()
    }
```

## 重要实现细节说明
- 授权请求：`deliverSystemNotification` 在调度前会调用 `requestAuthorization(options:)`。第一次调用会触发系统授权弹窗，用户必须允许 `Alert`（横幅）或 `Sound` 才能看到通知。
- 前台展示：默认情况下前台不展示横幅。为保证前台也显示，我们在 `AppDelegate` 的 `willPresent` 中返回 `[.banner, .sound, .list]`。
- 点击行为：我们在 `didReceive` 中主动 `NSApp.activate(ignoringOtherApps:)` 并把已有窗口置前，同时实现 `applicationShouldOpenUntitledFile(_:) -> Bool` 返回 `false`，尽量避免因为激活而触发系统自动创建新窗口。

## 测试步骤
1. 构建并在 macOS（本机）运行应用。确保运行的 App bundle id 与项目 Info.plist 中 `CFBundleIdentifier` 一致。  
2. 在 Settings → General 中切换 `Open at Login`，观察是否出现系统授权弹窗（仅首次）。  
3. 若授权已允许，切换后应在短延迟内看到系统通知横幅与声音。  
4. 点击通知：已实现逻辑会把已有窗口激活并置顶，而不会重复打开新的主窗口（除非系统确实没有任何窗口可用）。

## 排查常见问题
- 未看到授权弹窗：可能之前拒绝过授权；到 系统设置 → 通知 → SyncNos 检查/打开权限。  
- 仍不显示横幅（前台或后台）：确认 `UNUserNotificationCenter` 的 `authorizationStatus`（可在代码中调用 `getNotificationSettings` 并打印）。  
- 运行时使用不同 bundle id：Xcode Scheme / Run configuration 可能使用不同的 bundle id，导致系统将通知权限与另一个 app 绑定。

## 关于 Xcode Notification Capability 的说明（我们当前没有启用）
- 本项目当前**没有**在 Xcode 的 Target → Signing & Capabilities 中勾选任何与远程通知相关的 Capability（例如：Push Notifications、Time Sensitive Notifications、Communication Notifications 的远程能力）。  
- 简言之：我们只用了本地通知（local notifications），不需要开启任何 Capability；只有在使用 APNs 等远程推送时，才需要在 Xcode/Apple Developer 上增加配置。

### 简要介绍三类远程通知（Push / Time-Sensitive / Communication）
- Push Notifications（远程推送）
  - 描述：由后端服务器通过 Apple Push Notification service (APNs) 推送到设备。用于服务器驱动的消息/提醒。  
  - 开发要求：在 Xcode 打开 **Push Notifications** Capability；在 Apple Developer Portal 配置 APNs key/certificate；实现远程通知注册以获得 device token 并把 token 发给后端。  

- Time Sensitive Notifications（时效性）
  - 描述：对用户非常紧急/即时的通知（例如闹钟、重要提醒），可在 Focus/免打扰下短时间打断并高优先级展示。  
  - 开发要求：无单独 Xcode capability，但需要在请求授权时包含 `.timeSensitive` 选项，并在通知内容中设置 `interruptionLevel = .timeSensitive`。用户可以在系统设置中单独允许或禁止时效通知。  

- Communication Notifications（沟通类）
  - 描述：用于消息/通话等通信型通知，在系统中可以有特殊呈现或优先级（如联系人头像、聚合等）。  
  - 开发要求：通常不需要单独 Capability；但若实现 VoIP/CallKit/PushKit 等实时通信功能，会有额外的 capability 与 Apple 审核/配置要求。

### 何时需要打开 Capability
- 本地通知：不需要在 Xcode 启用 Capability。  
- 远程推送（APNs）：需要在 Xcode 打开 **Push Notifications** 并在 Apple Developer Portal 做相应配置。  

### 安全与隐私注意
- 本地通知不会泄露到服务器；远程推送会涉及 device token 的上报，注意在服务端妥善存储并遵守隐私策略。  

## 扩展建议
- 若希望更友好地处理“用户拒绝通知”的情况，建议在设置页增加一个“打开系统通知偏好”按钮并在用户拒绝时弹出引导（可直接跳转到系统通知偏好面板）。  
- 若未来需要服务器推送（例如跨设备同步完成提醒），请在后端准备 APNs 支持并在 Xcode 开启 Push Notifications capability。  
