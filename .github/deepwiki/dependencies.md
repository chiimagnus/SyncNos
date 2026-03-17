# 依赖关系

## 构建与运行时矩阵

| 产品线 / 层 | 语言 | 核心运行时 / 框架 | 构建入口 | 运行目标 |
| --- | --- | --- | --- | --- |
| SyncNos App | Swift 6 | SwiftUI、SwiftData、StoreKit 2、AppKit | `macOS/SyncNos.xcodeproj`, `xcodebuild` | macOS 14.0+ |
| MenuBarDockKit | SwiftPM | 本地可复用 macOS 组件 | `macOS/Packages/MenuBarDockKit/Package.swift` | 被 App 直接依赖 |
| WebClipper | TypeScript 5.9 | WXT、MV3、React 19、React Router 7、Vitest | `webclipper/package.json`, `wxt.config.ts` | Chrome / Edge / Firefox |
| 交付层 | YAML + Node 20 | GitHub Actions、打包脚本、商店 API | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` | GitHub Release / CWS / AMO |

## WebClipper 主要依赖

| 依赖 | 类型 | 版本 | 用途 |
| --- | --- | --- | --- |
| `react`, `react-dom` | runtime | `^19.2.4` | popup / app UI 渲染 |
| `react-router-dom` | runtime | `7.13.1` | 扩展内部 app 路由 |
| `recharts` | runtime | `^3.8.0` | Settings Insight 的来源分布 / 域名分布图表 |
| `markdown-it` | runtime | `^14.1.0` | Markdown 消息渲染 |
| `lucide-react` | runtime | `^0.541.0` | UI 图标 |
| `wxt` | dev | `^0.20.18` | MV3 开发与构建 |
| `@wxt-dev/module-react` | dev | `^1.1.5` | WXT React 模块 |
| `typescript` | dev | `^5.9.3` | 类型检查与编译约束 |
| `vitest` | dev | `^2.1.8` | 单元测试 |
| `fake-indexeddb`, `jsdom` | dev | `^6.2.2`, `^28.1.0` | 存储与 DOM 测试环境 |
| `tailwindcss`, `postcss`, `autoprefixer` | dev | `^3.4.17`, `^8.5.6`, `^10.4.21` | 扩展 UI 样式链 |

## App 主要依赖

| 依赖 | 类型 | 来源 | 用途 |
| --- | --- | --- | --- |
| SwiftUI | 系统框架 | App 工程 | 主窗口、设置窗口、日志窗口、Commands |
| SwiftData | 系统框架 | `Services/*CacheService.swift` | 本地缓存、后台 `@ModelActor` 访问 |
| StoreKit 2 | 系统框架 | `IAPService.swift` | 30 天试用期、购买、恢复购买 |
| AppKit | 系统框架 | `AppDelegate.swift` | 菜单栏、Dock、窗口 reopen、退出确认 |
| `MenuBarDockKit` | 本地 SwiftPM 包 | `macOS/Packages/MenuBarDockKit/` | 菜单栏 Popover、Dock / Window 辅助能力 |
| WebKit | 系统框架 | `SiteLoginsStore.swift` | 清理 WebKit cookies 等站点登录态相关能力 |

## 外部服务与平台

| 服务 / 平台 | 调用方 | 方式 | 作用 |
| --- | --- | --- | --- |
| Notion API / OAuth | App + WebClipper | HTTPS | Parent Page、数据库、页面属性、blocks 写入 |
| Obsidian Local REST API | WebClipper | 本地 HTTP | 把会话或文章写入 vault |
| Apple Books / GoodLinks 本地库 | App | 本地目录 / SQLite | 读取阅读高亮与元数据 |
| WeRead / Dedao 登录态 | App | Cookie Header / 站点会话 | 拉取在线阅读内容 |
| 浏览器 DOM | WebClipper | content script | 采集 AI 对话与网页正文 |
| GitHub Release / CWS / AMO | workflow + scripts | GitHub Actions / 商店 API | 生成与发布浏览器扩展产物 |

## 工具链与验证入口

| 工具 / 命令 | 位置 | 用途 | 备注 |
| --- | --- | --- | --- |
| `xcodebuild -project macOS/SyncNos.xcodeproj -scheme SyncNos -configuration Debug build` | 根 `AGENTS.md` | App 构建校验 | App 改动后的最小构建验证 |
| `npm --prefix webclipper run compile` | `package.json` | TypeScript 类型检查 | 默认验证顺序第一步 |
| `npm --prefix webclipper run test` | `package.json` | Vitest 单元测试 | 游标、迁移、Markdown、存储逻辑 |
| `npm --prefix webclipper run build` | `package.json` | 生成 Chrome / Edge 构建产物 | `check` 之前的基础步骤 |
| `npm --prefix webclipper run check` | `package.json` | build 后跑 `check-dist.mjs` | 验证 dist 完整性与关键引用 |
| `node .github/scripts/webclipper/package-release-assets.mjs` | `.github/scripts/webclipper/` | 打包 Chrome / Edge / Firefox 正式附件 | workflow 直接复用 |

## 版本与兼容性规则

| 项 | 当前值 | 来源 | 为什么重要 |
| --- | --- | --- | --- |
| WebClipper `package.json` 版本 | `2003.08.20` | `webclipper/package.json` | 表示 npm 包层面的版本语义 |
| WebClipper manifest 版本 | 见 `configuration.md`（单一事实源） | `webclipper/wxt.config.ts` | CWS / AMO / Edge workflow 直接拿它和 tag 对齐 |
| Manifest 模式 | `3` | `wxt.config.ts` | 决定扩展是 MV3 架构 |
| Swift tools version | `6.0` | `macOS/Packages/MenuBarDockKit/Package.swift` | 说明本地 SwiftPM 包按 Swift 6 维护 |
| App 平台 | macOS 14.0+ | `Package.swift`, 仓库文档 | SwiftUI + SwiftData + AppKit 组合的最低运行环境 |
| CI Node 版本 | `20` | `webclipper-*.yml` | 统一打包与发布环境 |

- **重要区分**：WebClipper 发布 workflow 只强制校验 `wxt.config.ts` 的 `manifest.version` 与 `v*` tag 是否一致，不会校验 `package.json` 的 `version`。
- **权限边界**：扩展 manifest 使用 `storage`, `contextMenus`, `tabs`, `webNavigation`, `activeTab`, `scripting`，并配合广泛 `host_permissions` 覆盖支持站点与普通网页；UI 是否真正启动仍受运行时 gating 控制。

## 修改依赖时最应该注意什么

| 改动类型 | 先看哪里 | 需要同步什么 |
| --- | --- | --- |
| App 新服务或新来源 | `macOS/SyncNos/AGENTS.md`, `DIContainer.swift` | 协议、注入、Service / ViewModel 边界 |
| 扩展新增依赖 / 构建插件 | `package.json`, `wxt.config.ts`, workflow | 构建、本地验证、CI 环境 |
| 发布版本调整 | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | manifest version 与 tag |
| 新增权限或 host 权限 | `wxt.config.ts`, `bootstrap/content.ts` | manifest、运行时 gating、文档 |

## 来源引用（Source References）
- `AGENTS.md`
- `macOS/SyncNos/AGENTS.md`
- `macOS/SyncNos/SyncNosApp.swift`
- `macOS/SyncNos/AppDelegate.swift`
- `webclipper/package.json`
- `webclipper/wxt.config.ts`
- `macOS/Packages/MenuBarDockKit/Package.swift`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/scripts/webclipper/package-release-assets.mjs`
