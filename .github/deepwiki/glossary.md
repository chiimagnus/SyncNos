# 术语表

## 使用说明
- 本页按“仓库级 → App → WebClipper → 同步/存储 → 发布”分组，避免不同上下文里的同一个词被误解。
- 对于既出现在业务说明又出现在代码中的词，优先采用仓库文档里的定义，再用代码位置补充“它具体落在哪个模块”。
- 当你在其他页面看到 `Parent Page`、`collector`、`cursor`、`@ModelActor` 等词时，建议先回到本页对齐语义。

## 仓库级术语
| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| 双产品线 | 同一仓库内的 macOS App 与 WebClipper 扩展 | `README.md`, `AGENTS.md` |
| Parent Page | Notion 中承载 SyncNos 产物的父页面 | `.github/docs/business-logic.md` |
| 条目（Item） | 一个可同步对象，如书、文章、对话 | `.github/docs/business-logic.md` |
| 内容片段 | 条目下的高亮、笔记、消息或文章正文片段 | `.github/docs/business-logic.md` |
| 归一化（Normalization） | 把异构来源整理成统一同步结构的过程 | `.github/docs/business-logic.md` |

## SyncNos App 术语
| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| Onboarding | 首次进入主界面前必须完成的引导流程 | `.github/docs/business-logic.md`, `SyncNos/SyncNosApp.swift` |
| PayWall | 试用、过期、欢迎态等付费拦截 / 提醒界面 | `.github/docs/business-logic.md` |
| `@Observable` | App 新代码首选的状态管理写法 | `SyncNos/AGENTS.md` |
| `@ModelActor` | SwiftData 后台服务实现模式 | `SyncNos/Services/AGENTS.md` |
| `DIContainer` | App 依赖注入组合根 | `SyncNos/Services/Core/DIContainer.swift` |
| `WindowReader` | 让 SwiftUI 读取 `NSWindow` 的桥接能力 | `Packages/MenuBarDockKit/README.md`, 键盘导航文档 |

## WebClipper 术语
| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| collector | 负责识别站点并抽取消息 / 文章正文的适配器 | `Extensions/WebClipper/AGENTS.md` |
| inpage | 页面内按钮与提示 UI，不等于 popup | `Extensions/WebClipper/AGENTS.md`, `src/entrypoints/content.ts` |
| popup | 浏览器工具栏弹窗 UI | `Extensions/WebClipper/src/entrypoints/popup/` |
| app | 扩展内部完整页面 UI | `Extensions/WebClipper/src/entrypoints/app/` |
| service worker / background | 后台消息路由与同步编排入口 | `Extensions/WebClipper/src/entrypoints/background.ts` |
| `Fetch Current Page` | 手动抓取当前网页文章并存为 article 会话的入口 | `Extensions/WebClipper/AGENTS.md` |

## 同步与存储术语
| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| cursor | 表示同步进度的游标，用于判断是否可以增量追加 | `.github/docs/business-logic.md`, `tests/unit/notion-sync-cursor.test.ts` |
| `contentMarkdown` | 可直接转为 Notion blocks 的 Markdown 内容 | `.github/docs/business-logic.md`, `Extensions/WebClipper/AGENTS.md` |
| Zip v2 | WebClipper 当前标准备份格式 | `Extensions/WebClipper/AGENTS.md` |
| `chrome.storage.local` | 扩展的非敏感设置存储 | `Extensions/WebClipper/AGENTS.md` |
| Keychain | App 本地安全存储敏感凭据的系统能力 | `.github/docs/business-logic.md` |
| `SyncNos.FontScaleLevel` | App 动态字体等级配置键 | `SyncNos/Services/Core/AGENTS.md` |

## 开发与发布术语
| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| WXT | WebClipper 使用的扩展开发与打包框架 | `Extensions/WebClipper/package.json`, `wxt.config.ts` |
| MV3 | 浏览器扩展的 Manifest V3 模式 | `Extensions/WebClipper/wxt.config.ts` |
| `workflow_dispatch` | 可手动触发的 GitHub Actions 入口 | `.github/workflows/*.yml` |
| AMO | Firefox Add-ons 发布渠道 | `.github/workflows/webclipper-amo-publish.yml` |
| CWS | Chrome Web Store 发布渠道 | `.github/workflows/webclipper-cws-publish.yml` |
| Release Assets | GitHub Release 上附带的 zip / xpi 产物 | `.github/workflows/webclipper-release.yml` |

## 示例片段
### 片段 1：消息协议中的术语直接定义了 WebClipper 的跨进程边界
```ts
export const ARTICLE_MESSAGE_TYPES = {
  FETCH_ACTIVE_TAB: 'fetchActiveTabArticle',
} as const;
```

### 片段 2：App 侧通知名和焦点管理语境是仓库级术语的重要来源
```swift
extension Notification.Name {
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
}
```

## 来源定位
| 术语群 | 优先查看路径 | 说明 |
| --- | --- | --- |
| 业务术语 | `.github/docs/business-logic.md` | 对“条目”“内容片段”“Parent Page”等给出统一解释。 |
| App 架构术语 | `SyncNos/AGENTS.md`, `SyncNos/Services/AGENTS.md` | 对 Observation、`@ModelActor`、Adapter 等有明确约束。 |
| WebClipper 术语 | `Extensions/WebClipper/AGENTS.md`, `message-contracts.ts` | 对 collector、inpage、消息类型和备份结构定义最全。 |
| 发布术语 | `.github/workflows/*.yml` | 对 tag、产物、商店发布等有直接证据。 |

## 来源引用（Source References）
- `.github/docs/business-logic.md`
- `AGENTS.md`
- `SyncNos/AGENTS.md`
- `SyncNos/Services/AGENTS.md`
- `SyncNos/Services/Core/AGENTS.md`
- `.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
- `Extensions/WebClipper/AGENTS.md`
- `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
- `.github/guide/obsidian/LocalRestAPI.zh.md`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `Packages/MenuBarDockKit/README.md`
