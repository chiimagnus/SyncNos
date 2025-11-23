# 30天免费试用实现说明

## 实现概述

已完成用户友好且防滥用的 30 天免费试用机制，包含欢迎引导、温和提醒和付费墙。

## 核心逻辑

### 1. 试用期管理 (IAPService)
- **首次启动记录**: 自动记录用户首次启动时间（UserDefaults + Keychain 双重存储）
- **设备指纹**: 使用硬件 UUID 生成设备指纹，防止卸载重装刷试用
- **试用期检查**: 计算距离首次启动的天数
- **解锁逻辑**: `isProUnlocked = hasPurchased || isInTrialPeriod`

### 2. 防滥用机制
- **双重存储**: UserDefaults + Keychain，Keychain 数据在卸载后仍保留
- **设备指纹**: 基于硬件 UUID，无法通过重装应用绕过
- **温和策略**: 不会误伤正常用户，只在关键时刻提醒

### 3. 关键属性
- `hasPurchased`: 是否已购买（年订阅或买断制）
- `isInTrialPeriod`: 是否在 30 天试用期内
- `trialDaysRemaining`: 剩余试用天数
- `isProUnlocked`: 是否解锁专业功能（购买或试用期内）
- `hasShownWelcome`: 是否已显示欢迎页面
- `shouldShowTrialReminder()`: 是否应显示试用期提醒

### 4. 用户体验流程

#### ✅ 首次启动
- 显示欢迎页面（WelcomeView）
- 介绍应用功能和 30 天试用
- 点击"Get Started"开始使用

#### ✅ 试用期内
- 完整功能访问
- 设置页面固定显示"剩余试用 X 天"
- 在第 7、3、1 天时温和提醒（每天最多一次）

#### ✅ 试用期提醒
- **7 天剩余**: 蓝色图标，"Trial Ending Soon"
- **3 天剩余**: 橙色图标，"Only 3 Days Left"
- **1 天剩余**: 红色图标，"Last Day of Trial"
- 提供"View Plans"和"Remind Me Later"选项

#### ✅ 试用期后
- 弹出付费墙（PaywallView）
- 显示两个购买选项（年订阅 ¥18 / 买断制 ¥68）
- 支持恢复购买
- 必须购买才能继续使用

#### ✅ 购买后
- 永久解锁，不再显示任何提醒
- 设置页面显示"Pro Features Unlocked - Purchased"

## 文件修改清单

### 核心服务层
- ✅ `SyncNos/Services/Auth/IAPService.swift` - 完整试用期逻辑、设备指纹、提醒机制
- ✅ `SyncNos/Services/Core/KeychainHelper.swift` - 添加试用期数据持久化
- ✅ `SyncNos/Services/Core/Protocols.swift` - 更新协议定义

### 视图模型层
- ✅ `SyncNos/ViewModels/Account/IAPViewModel.swift` - 添加试用期状态管理

### 视图层
- ✅ `SyncNos/Views/Settting/General/IAPView.swift` - 固定显示试用期状态
- ✅ `SyncNos/Views/Settting/General/PaywallView.swift` - 付费墙视图
- ✅ `SyncNos/Views/Settting/General/WelcomeView.swift` - 新建欢迎页面
- ✅ `SyncNos/Views/Settting/General/TrialReminderView.swift` - 新建试用期提醒
- ✅ `SyncNos/Views/Components/MainListView.swift` - 集成欢迎、提醒、付费墙逻辑

### 应用入口
- ✅ `SyncNos/SyncNosApp.swift` - 初始化试用期并记录日志

## 架构遵循

严格遵循 MVVM 架构：
- **Model**: 试用期数据存储在 UserDefaults
- **ViewModel**: IAPViewModel 管理状态和业务逻辑
- **View**: PaywallView 纯 UI 展示
- **Service**: IAPService 处理试用期和购买逻辑

使用 Combine 响应式编程：
- `@Published` 属性自动触发 UI 更新
- `NotificationCenter` 发布状态变更
- 依赖注入通过 `DIContainer.shared`

## 测试建议

### 基础功能测试
1. **首次启动**: 删除应用，重新安装，验证欢迎页面显示
2. **试用期显示**: 在设置页面验证"剩余试用 X 天"固定显示
3. **提醒测试**: 修改系统时间到第 7/3/1 天，验证提醒弹出
4. **付费墙测试**: 修改系统时间到 30 天后，验证付费墙弹出
5. **购买测试**: 使用 StoreKit Configuration 测试购买流程
6. **恢复测试**: 测试恢复购买功能

### 防滥用测试
1. **卸载重装**: 卸载应用后重新安装，验证试用期不会重置（Keychain 保留）
2. **UserDefaults 清除**: 手动清除 UserDefaults，验证从 Keychain 恢复
3. **设备指纹**: 验证设备指纹正确生成并存储

### 用户体验测试
1. **欢迎页面**: 只在首次启动显示一次
2. **提醒频率**: 每天最多显示一次提醒
3. **购买后**: 验证所有提醒和付费墙不再显示

## 注意事项

### 数据存储
- **UserDefaults**: 首次启动时间、设备指纹、提醒记录
- **Keychain**: 首次启动时间、设备指纹（持久化，卸载后保留）
- **双重保障**: UserDefaults 优先，Keychain 作为备份

### 防滥用策略
- 基于硬件 UUID 的设备指纹，无法通过重装绕过
- Keychain 数据在卸载后仍保留
- 温和策略，不会误伤正常用户

### 用户体验
- ❌ 不会每次打开都弹窗
- ✅ 首次使用时显示欢迎页面
- ✅ 试用剩余 7、3、1 天时温和提醒（每天最多一次）
- ✅ 设置页面固定显示"剩余试用 X 天"
- ✅ 试用期结束后才显示付费墙
