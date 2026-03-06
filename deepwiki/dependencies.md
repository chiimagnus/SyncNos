# 依赖关系

## 构建与运行时
| 产品线 | 语言 | 核心框架 / 运行时 | 构建入口 | 运行目标 |
| --- | --- | --- | --- | --- |
| SyncNos App | Swift 6.0+ | SwiftUI、SwiftData、StoreKit、AppKit | `SyncNos.xcodeproj`, `xcodebuild` | macOS 14.0+ |
| WebClipper | TypeScript 5.9+ | WXT、React 19、MV3、Vitest | `package.json`, `wxt.config.ts` | Chrome / Edge / Firefox |
| 共享自动化 | YAML + Node | GitHub Actions、Node 20 | `.github/workflows/*.yml` | Release / 商店发布 |

## 依赖细节
| 依赖 | 类型 | 版本 / 约束 | 用途 |
| --- | --- | --- | --- |
| `react` | 运行时依赖 | `^19.2.4` | WebClipper popup / app UI 渲染。 |
| `react-router-dom` | 运行时依赖 | `7.13.1` | WebClipper 应用内路由。 |
| `markdown-it` | 运行时依赖 | `^14.1.0` | 渲染消息 Markdown。 |
| `wxt` | 开发依赖 | `^0.20.18` | MV3 扩展开发与构建。 |
| `vitest` | 开发依赖 | `^2.1.8` | WebClipper 单元测试。 |
| `typescript` | 开发依赖 | `^5.9.3` | WebClipper 类型检查与编译约束。 |
| `tailwindcss` | 开发依赖 | `^3.4.17` | 扩展 UI 样式系统。 |

| Apple / Swift 侧依赖 | 类型 | 来源 | 用途 |
| --- | --- | --- | --- |
| SwiftUI | 系统框架 | `SyncNos/AGENTS.md` | App 界面、窗口和 Commands。 |
| SwiftData | 系统框架 | `SyncNos/Services/AGENTS.md` | 缓存模型、后台 `@ModelActor` 服务。 |
| StoreKit | 系统框架 | `SyncNos/SyncNosApp.swift` | 订阅与试用状态管理。 |
| AppKit | 系统框架 | `SyncNos/AppDelegate.swift`, 键盘导航文档 | 菜单栏、键盘事件和窗口管理。 |
| `MenuBarDockKit` | 本地 SwiftPM 包 | `Packages/MenuBarDockKit/Package.swift` | 菜单栏 / Dock / `WindowReader` 通用能力。 |

## 外部服务
| 服务 / 系统 | 调用方 | 协议 / 方式 | 用途 |
| --- | --- | --- | --- |
| Notion API / OAuth | App + WebClipper | HTTPS | 创建 / 复用数据库、页面与 blocks。 |
| Obsidian Local REST API | WebClipper | 本地 HTTP `127.0.0.1:27123` | 把聊天或文章写入 vault。 |
| Apple Books / GoodLinks 数据库 | App | 本地目录 + SQLite | 读取高亮、笔记和元数据。 |
| WeRead / Dedao 站点会话 | App | Cookie / 登录态 | 拉取站点侧高亮与笔记。 |
| 浏览器本地存储 | WebClipper | IndexedDB + `chrome.storage.local` | 存会话、设置与备份元信息。 |
| GitHub Release / 商店 API | WebClipper 发布流程 | GitHub Actions / CWS / AMO | 生成和发布浏览器扩展产物。 |

## 开发工具
| 工具 | 位置 | 用途 | 备注 |
| --- | --- | --- | --- |
| `xcodebuild` | 根 `AGENTS.md` | App 构建校验 | 文档改动通常不需要执行。 |
| `npm --prefix Extensions/WebClipper run compile` | `package.json` | TypeScript 编译检查 | WebClipper 默认验证顺序的第一步。 |
| `npm --prefix Extensions/WebClipper run test` | `package.json` | Vitest 单元测试 | 覆盖渲染、游标、IndexedDB 迁移等。 |
| `npm --prefix Extensions/WebClipper run build` | `package.json` | 构建 Chrome / Edge 产物 | 发布前也会在 workflow 中执行。 |
| `node .github/scripts/webclipper/package-release-assets.mjs` | 根 `AGENTS.md` | 打包 Chrome / Edge / Firefox 发布资产 | 由 CI 主导。 |
| `softprops/action-gh-release@v2` | `.github/workflows/release.yml` | 发布 GitHub Release | 把 tag 内容写到 Release 页面。 |

## 示例片段
### 片段 1：WebClipper 的脚本入口直接体现依赖关系
```json
"dev": "wxt --mv3",
"build": "wxt build --mv3",
"check": "npm run build && node ../../.github/scripts/webclipper/check-dist.mjs --root=Extensions/WebClipper/.output/chrome-mv3",
"test": "vitest run"
```

### 片段 2：MenuBarDockKit 是一个本地 SwiftPM 包，而不是外部二进制依赖
```swift
let package = Package(
    name: "MenuBarDockKit",
    platforms: [.macOS(.v14)],
    products: [.library(name: "MenuBarDockKit", targets: ["MenuBarDockKit"])]
)
```

## 兼容性说明
| 维度 | 约束 | 说明 |
| --- | --- | --- |
| App 平台 | macOS 14.0+ | 使用 SwiftUI + SwiftData + AppKit 组合。 |
| WebClipper 浏览器 | Chrome / Edge / Firefox | 开发产物由 WXT 输出为 MV3 结构。 |
| 扩展权限 | `storage`, `tabs`, `webNavigation`, `activeTab`, `scripting` | 配合 `host_permissions` 访问支持站点和 Notion。 |
| Obsidian 连接 | 仅 HTTP insecure 模式 | 当前不支持自签名 HTTPS。 |

## 版本说明
| 项 | 当前值 | 来源 | 说明 |
| --- | --- | --- | --- |
| WebClipper `package.json` 版本 | `0.14.6` | `Extensions/WebClipper/package.json` | NPM 包层面的版本号。 |
| WebClipper manifest 版本 | `1.1.2` | `Extensions/WebClipper/wxt.config.ts` | workflow 会校验其与 tag 是否一致。 |
| Swift tools 版本 | `6.0` | `Packages/MenuBarDockKit/Package.swift` | 说明本地 SwiftPM 包使用 Swift 6。 |
| GitHub Actions Node 版本 | `20` | `.github/workflows/webclipper-*.yml` | CI 中固定的 Node 执行环境。 |

## 来源引用（Source References）
- `AGENTS.md`
- `SyncNos/AGENTS.md`
- `SyncNos/SyncNosApp.swift`
- `SyncNos/AppDelegate.swift`
- `Extensions/WebClipper/package.json`
- `Extensions/WebClipper/wxt.config.ts`
- `Extensions/WebClipper/AGENTS.md`
- `Packages/MenuBarDockKit/Package.swift`
- `Packages/MenuBarDockKit/README.md`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/guide/obsidian/LocalRestAPI.zh.md`
