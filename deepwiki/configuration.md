# 配置

## 配置入口
| 配置面 | 路径 / 界面 | 写入方 | 说明 |
| --- | --- | --- | --- |
| App 启动与行为配置 | `SyncNos/SyncNosApp.swift` + UserDefaults | App | 管理自动同步、调试引导等启动期行为。 |
| App 基础设施配置 | `SyncNos/Services/Core/AGENTS.md` | App | 管理字体缩放、日志、DI 注册等跨模块配置。 |
| App URL scheme | `SyncNos/Info.plist` | Xcode / App | 配置 `syncnos` 回调用于 OAuth 兜底处理。 |
| WebClipper manifest 配置 | `Extensions/WebClipper/wxt.config.ts` | WXT | 管理名称、版本、权限和 host permissions。 |
| WebClipper 本地设置 | popup `Settings`、`chrome.storage.local` | WebClipper UI | 管理 inpage、Obsidian、Notion 相关设置。 |
| 发布参数 | `.github/workflows/*.yml` | GitHub Actions | 管理 tag、发布目标与 Node 版本。 |

## macOS App 配置项
| 配置项 | 位置 | 默认 / 示例 | 作用 |
| --- | --- | --- | --- |
| `debug.forceOnboardingEveryLaunch` | `SyncNos/SyncNosApp.swift` | `false` | Debug 环境下可强制每次启动重置引导状态。 |
| `autoSync.appleBooks` | `SyncNos/SyncNosApp.swift` | UserDefaults 布尔值 | 启动后决定是否开启 Apple Books 自动同步。 |
| `autoSync.goodLinks` | `SyncNos/SyncNosApp.swift` | UserDefaults 布尔值 | 启动后决定是否开启 GoodLinks 自动同步。 |
| `autoSync.weRead` | `SyncNos/SyncNosApp.swift` | UserDefaults 布尔值 | 启动后决定是否开启 WeRead 自动同步。 |
| `SyncNos.FontScaleLevel` | `SyncNos/Services/Core/AGENTS.md` | 离散等级 | 控制 App 全局字体与布局缩放。 |
| `CFBundleURLSchemes = syncnos` | `SyncNos/Info.plist` | 固定值 | 处理 OAuth URL callback。 |

## WebClipper 配置项
| 配置项 | 位置 | 默认 / 示例 | 作用 |
| --- | --- | --- | --- |
| `manifestVersion` | `wxt.config.ts` | `3` | 决定扩展运行在 MV3。 |
| `entrypointsDir` | `wxt.config.ts` | `src/entrypoints` | 固定 background / content / popup / app 的入口目录。 |
| `inpage_supported_only` | `Extensions/WebClipper/AGENTS.md` | `false` | 控制 inpage 按钮显示范围。 |
| Obsidian `Base URL` | `LocalRestAPI.zh.md` | `http://127.0.0.1:27123` | 连接本地 Obsidian 插件。 |
| Obsidian `Auth Header` | `LocalRestAPI.zh.md` | `Authorization` | 发送 API Key 的请求头名。 |
| 备份敏感键排除 | `Extensions/WebClipper/AGENTS.md` | `notion_oauth_token*`, `notion_oauth_client_secret` | 避免把敏感配置写进备份包。 |

## 构建与发布参数
| 参数 | 位置 | 值 / 规则 | 影响 |
| --- | --- | --- | --- |
| Node 版本 | `.github/workflows/webclipper-release.yml` | `20` | 统一 WebClipper CI 环境。 |
| WebClipper manifest 版本 | `wxt.config.ts` | `1.1.2` | 发布 workflow 会校验其与 tag 一致。 |
| Release 触发条件 | `.github/workflows/release.yml` | `push tags: v*` 或 `workflow_dispatch` | 决定 GitHub Release 何时生成。 |
| CWS `publish_target` | `.github/workflows/webclipper-cws-publish.yml` | `default` / `trustedTesters` | 决定 Chrome Web Store 发布范围。 |
| AMO 发布通道 | `.github/workflows/webclipper-amo-publish.yml` | `listed` | 决定 Firefox 商店提交流程。 |

## 权限与安全边界
| 面 | 配置 | 安全意图 | 备注 |
| --- | --- | --- | --- |
| 扩展权限 | `storage`, `tabs`, `webNavigation`, `activeTab`, `scripting` | 尽量保持最小权限集合 | 额外权限需要明确理由。 |
| 扩展 host permissions | 支持站点、Notion、`http(s)://*/*` | 让 content script 在运行时决定是否激活 | 通过 `inpage_supported_only` 做 UI gating。 |
| App 本地敏感存储 | Keychain / 加密服务 | 避免凭据明文落盘 | Chats 本地存储加密由 `EncryptionService` 支撑。 |
| 备份导入导出 | 排除敏感键 | 防止 API Token 跟随备份传播 | Zip v2 仍保留非敏感设置。 |

## 示例片段
### 片段 1：WebClipper 的 manifest 配置把能力和边界写得很直白
```ts
manifest: {
  permissions: ['storage', 'tabs', 'webNavigation', 'activeTab', 'scripting'],
  host_permissions: ['https://chat.openai.com/*', 'https://api.notion.com/*', 'http://*/*', 'https://*/*']
}
```

### 片段 2：App 的 URL scheme 由 Info.plist 固定声明
```xml
<key>CFBundleURLSchemes</key>
<array>
  <string>syncnos</string>
</array>
```

## 常见误配
- 打开 Obsidian 连接失败时，先检查是不是误用了 `https://127.0.0.1:27124`；当前仓库只支持 HTTP insecure 模式。
- 修改 `wxt.config.ts` 中的 `version` 后，如果没有同步 tag，发布 workflow 会因为 manifest 版本不匹配而失败。
- `inpage_supported_only` 的变更只会对新打开或刷新后的页面生效，当前页面不会热更新。
- App 新增顶层窗口时，如果忘记应用 `.applyFontScale()` 或没有考虑菜单栏 / Dock 模式，体验会与现有窗口不一致。

## 来源引用（Source References）
- `AGENTS.md`
- `SyncNos/SyncNosApp.swift`
- `SyncNos/AppDelegate.swift`
- `SyncNos/Info.plist`
- `SyncNos/Services/Core/AGENTS.md`
- `Extensions/WebClipper/package.json`
- `Extensions/WebClipper/wxt.config.ts`
- `Extensions/WebClipper/AGENTS.md`
- `.github/guide/obsidian/LocalRestAPI.zh.md`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
