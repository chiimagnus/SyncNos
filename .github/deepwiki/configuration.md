# 配置

## 配置入口

| 配置面 | 路径 / 界面 | 存储位置 | 说明 |
| --- | --- | --- | --- |
| App 启动与门控 | `SyncNosApp.swift`, `RootView.swift` | UserDefaults | 控制 onboarding、自动同步、调试开关 |
| App URL scheme 与窗口行为 | `Info.plist`, `AppDelegate.swift` | 工程配置 + 本地偏好 | OAuth 回调、菜单栏 / Dock 模式 |
| App 同步参数 | `NotionSyncConfig.swift` | 代码常量 | 控制并发、RPS、超时、批量大小 |
| WebClipper manifest | `wxt.config.ts` | 代码配置 | 控制版本、权限、entrypointsDir、host permissions |
| WebClipper 运行时设置 | SettingsScene + `chrome.storage.local` | 浏览器本地 KV | 控制 Notion parent page、Obsidian、inpage 开关、Chat with AI、自定义设置分区（含 Insight 导航）、Notion AI 模型偏好 |
| 发布参数 | `.github/workflows/*.yml` | workflow inputs / env | 控制 tag、Node 版本、CWS / AMO 行为 |

## macOS App 配置项

| 配置项 | 位置 | 默认 / 约束 | 作用 |
| --- | --- | --- | --- |
| `hasCompletedOnboarding` | `RootView.swift`, `OnboardingViewModel.swift` | `false` → 完成后写为 `true` | 决定是否先进入 onboarding |
| `debug.forceOnboardingEveryLaunch` | `SyncNosApp.swift` | Debug 默认注册为 `false` | 开发时强制每次启动重走 onboarding |
| `autoSync.appleBooks` / `goodLinks` / `weRead` | `SyncNosApp.swift` | UserDefaults 布尔值 | 决定启动时是否自动开启 AutoSyncService |
| `SyncNos.FontScaleLevel` | `macOS/SyncNos/Services/Core/AGENTS.md` | 离散等级 | 控制字体与布局缩放 |
| `CFBundleURLSchemes = syncnos` | `Info.plist` | 固定 | 处理 OAuth URL callback 兜底 |
| Notion 同步参数 | `NotionSyncConfig.swift` | `batchConcurrency=3`, `readRPS=8`, `writeRPS=3`, `appendBatchSize=50`, `timeout=120s` | 控制 App 到 Notion 的吞吐与稳定性 |

## WebClipper 配置项

| 配置项 | 位置 | 当前值 / 默认 | 作用 |
| --- | --- | --- | --- |
| `manifestVersion` | `wxt.config.ts` | `3` | 扩展固定在 MV3 模式 |
| `manifest.version` | `wxt.config.ts` | `1.2.2` | 商店 workflow 校验的版本事实源 |
| `entrypointsDir` | `wxt.config.ts` | `src/entrypoints` | 统一 background/content/popup/app 入口目录 |
| `inpage_supported_only` | `chrome.storage.local`, `bootstrap/content.ts` | 默认按 `false` 处理 | 控制非支持站点是否也启动 inpage UI |
| `notion_parent_page_id`, `notion_parent_page_title` | `chrome.storage.local`, SettingsScene controller | 用户选择值 | 决定扩展 Notion 的写入根 |
| `notion_ai_preferred_model_index` | `chrome.storage.local` | 空字符串或正整数 | 控制 Notion AI model picker 偏好 |
| `chat_with_prompt_template_v1`, `chat_with_ai_platforms_v1`, `chat_with_max_chars_v1` | `chatwith-settings.ts`, `chrome.storage.local` | 默认模板 + 平台清单 + `28000` | 控制 Chat with AI 的载荷模板、目标平台和截断长度 |
| `webclipper_settings_active_section` | `ui/settings/types.ts`, `localStorage` | 默认 `backup`；支持 `backup / notion / obsidian / chat_with / insight / inpage / about` | 记住设置页当前选中的 sidebar 分组 / section |
| Insight 统计限制 | `ui/settings/sections/insight-stats.ts` | `INSIGHT_CHAT_SOURCE_LIMIT=4`, `INSIGHT_ARTICLE_DOMAIN_LIMIT=8`, `INSIGHT_TOP_CONVERSATION_LIMIT=3` | 控制平台来源排行、文章域名排行与 Top conversation 截断方式 |
| Obsidian 设置 | `obsidian*` settings store | `apiBaseUrl`, `authHeaderName`, `chatFolder`, `articleFolder`, 可选 API Key | 控制扩展写入本地 vault |
| 备份敏感键排除 | `backup-utils.ts` | 精确排除 `notion_oauth_token_v1`, `notion_oauth_client_secret`，且排除任何 `notion_oauth_token*` | 避免敏感信息进入备份 |

- 扩展 UI 文案没有独立的“语言设置”键；`i18n/index.ts` 会按 `navigator.language` 自动在 `en` / `zh` 间切换。
- Insight 不写入新的 `chrome.storage.local` 键；统计只在用户打开 `Settings → Insight` 时从 IndexedDB 现算，失败时回到错误态或空态。

## 发布参数

| 参数 | 位置 | 值 / 规则 | 影响 |
| --- | --- | --- | --- |
| Release 触发条件 | `.github/workflows/release.yml` | `push tags: v*` 或 `workflow_dispatch` | 决定 GitHub Release 页面何时创建 |
| WebClipper CI Node 版本 | `webclipper-*.yml` | `20` | 保持构建与发布一致 |
| CWS `publish_target` | `webclipper-cws-publish.yml` | `default` / `trustedTesters` | 控制 Chrome Web Store 发布范围 |
| AMO channel | `webclipper-amo-publish.yml` | `listed` | 控制 Firefox 商店提交通道 |
| 版本一致性规则 | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | `tag 去掉 v == manifest.version` | 阻止错误版本发布 |

## 权限与安全边界

| 面 | 真实配置 | 安全意图 | 备注 |
| --- | --- | --- | --- |
| 扩展权限 | `storage`, `tabs`, `webNavigation`, `activeTab`, `scripting` | 尽量只保留采集与本地保存所需能力 | 新增权限必须解释原因 |
| 扩展 host permissions | 支持站点 + Notion + `http://*/*` + `https://*/*` | 允许 content script 在运行时自行判断是否激活 | UI 级别再由 `inpage_supported_only` 做 gating |
| App 敏感存储 | Keychain / 加密服务 | 避免站点 Cookie、加密密钥、试用期关键数据明文落盘 | `SiteLoginsStore`, `EncryptionService`, `IAPService` |
| 备份导入导出 | denylist + 前缀过滤 | 防止 OAuth token 跟随备份扩散 | Zip v2 仍保留非敏感运行设置 |

## 常见误配
- **改了 `wxt.config.ts` 的 `manifest.version` 却没对齐 tag**：CWS / AMO workflow 会直接报 `manifest version mismatch`。
- **切了 `inpage_supported_only` 但当前页不变**：因为 content script 只在启动时读取该开关，必须刷新或新开页面。
- **只在 Settings 里连上 Notion、却没选 Parent Page**：扩展仍然不能真正写入 Notion 页面。
- **Obsidian 使用了错误的 URL / header / API Key**：当前设计默认围绕 `http://127.0.0.1:27123` 与 `Authorization` 头工作。
- **App 只改 UI 没考虑字体缩放或窗口模式**：新视图若没调用现有字体 / 窗口辅助能力，体验会与主窗口不一致。

## 示例片段
### 片段 1：WebClipper 的 manifest 权限和 host permissions 由 `wxt.config.ts` 直接声明
```ts
manifest: {
  version: '1.2.2',
  permissions: ['storage', 'tabs', 'webNavigation', 'activeTab', 'scripting'],
  host_permissions: ['https://chat.openai.com/*', 'https://api.notion.com/*', 'http://*/*', 'https://*/*']
}
```

### 片段 2：App 同步参数是代码层常量，而不是运行时配置面板
```swift
static let batchConcurrency: Int = 3
static let notionReadRequestsPerSecond: Int = 8
static let notionWriteRequestsPerSecond: Int = 3
static let requestTimeoutSeconds: TimeInterval = 120
```

## 来源引用（Source References）
- `macOS/SyncNos/SyncNosApp.swift`
- `macOS/SyncNos/AppDelegate.swift`
- `macOS/SyncNos/Views/RootView.swift`
- `macOS/SyncNos/Info.plist`
- `macOS/SyncNos/Services/DataSources-To/Notion/Config/NotionSyncConfig.swift`
- `webclipper/wxt.config.ts`
- `webclipper/src/bootstrap/content.ts`
- `webclipper/src/bootstrap/current-page-capture.ts`
- `webclipper/src/i18n/index.ts`
- `webclipper/src/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/ui/settings/types.ts`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/ui/settings/sections/insight-stats.ts`
- `webclipper/src/sync/backup/backup-utils.ts`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
