# Deepwiki Index

## 摘要
- **正式入口**：先读 [business-context.md](business-context.md)，先建立产品语义，再进入仓库结构与实现细节。
- **仓库形态**：这是一个双产品线仓库——`macOS/` 是 macOS App 容器（源码位于 `macOS/SyncNos/`），`webclipper/` 是浏览器扩展；两者都围绕“把异构内容整理为稳定知识资产”展开，但运行时、存储和用户动作完全不同。
- **近期关键变化**：WebClipper 的 Settings 现在包含只读的 Insight 仪表盘，用本地 IndexedDB 现算 clips 总量、AI 对话 / 网页文章分布、Top 3 conversation 与来源结构。
- **关键入口**：App 入口是 `macOS/SyncNos/SyncNosApp.swift` + `macOS/SyncNos/AppDelegate.swift`；扩展入口是 `webclipper/src/entrypoints/background.ts` + `content.ts`；发布入口是 `.github/workflows/*.yml` 与 `.github/scripts/webclipper/*.mjs`。
- **如何使用本索引**：如果你先想理解“产品做什么”，走 business-first；如果你已经准备改代码，走 engineering-first；如果你要发版本，走 release-first。

| 维度 | 主入口页面 | 你会得到什么 |
| --- | --- | --- |
| 业务入口 | [business-context.md](business-context.md) | 用户、产物、关键旅程、影响行为的业务规则 |
| 仓库总览 | [overview.md](overview.md) | 目录地图、入口文件、主要产物、推荐阅读顺序 |
| 技术总览 | [architecture.md](architecture.md) | 运行时边界、关键契约、修改热点 |
| 数据链路 | [data-flow.md](data-flow.md) | 来源 → 本地事实源 → Notion / Obsidian / 导出 |
| 产品细节 | `modules/` | App 与 WebClipper 各自的实现边界与扩展点 |

## 推荐阅读路径

### Business-first
1. [business-context.md](business-context.md) — 先理解仓库服务谁、交付什么、有哪些关键规则。
2. [overview.md](overview.md) — 再建立目录、入口和产物级别的整体地图。
3. [data-flow.md](data-flow.md) — 看清两个产品线各自如何把输入变成可见结果。
4. [modules/syncnos-app.md](modules/syncnos-app.md) — 如果你关注阅读高亮、OCR、IAP、菜单栏和 Notion 同步。
5. [modules/webclipper.md](modules/webclipper.md) — 如果你关注 AI 对话采集、文章抓取、本地会话和多目标同步。
6. [storage.md](storage.md) / [troubleshooting.md](troubleshooting.md) — 当你开始追问“数据存在哪”或“为什么失败”。

### Engineering-first
1. [architecture.md](architecture.md) — 先看运行时边界、依赖方向、关键契约。
2. [dependencies.md](dependencies.md) — 确认技术栈、第三方依赖、外部系统与版本规则。
3. [configuration.md](configuration.md) — 看 manifest、UserDefaults、Keychain、`chrome.storage.local`、发布参数。
4. [modules/syncnos-app.md](modules/syncnos-app.md) — 进入 App 的启动、门控、同步与缓存实现。
5. [modules/webclipper.md](modules/webclipper.md) — 进入扩展的 background/content/popup/app 分层与采集策略。
6. [data-flow.md](data-flow.md) — 对照真实输入输出链路检查改动影响面。
7. [testing.md](testing.md) — 确认验证顺序与现有测试覆盖。
8. [workflow.md](workflow.md) — 确认协作方式、文档同步与发布边界。

### Release-first
1. [release.md](release.md) — GitHub Release、CWS、AMO、产物命名和脚本职责。
2. [configuration.md](configuration.md) — `wxt.config.ts` 版本、Node 版本、权限与 workflow 参数。
3. [testing.md](testing.md) — 发布前的 compile / test / build / build:firefox / check 验证路径。
4. [troubleshooting.md](troubleshooting.md) — manifest 版本不匹配、AMO 补丁、Obsidian / Notion 连接问题。
5. [GENERATION.md](GENERATION.md) — 本次 deepwiki 更新覆盖了哪些页面、基于哪个 commit。

## 页面分组

| 分组 | 页面 | 说明 |
| --- | --- | --- |
| 业务入口层 | `business-context.md` | 用业务语义把读者送往技术页，而不是停留在 marketing 摘要。 |
| 基础全景 | `overview.md`, `architecture.md`, `dependencies.md`, `data-flow.md` | 帮你建立仓库全貌、运行时边界和主链路。 |
| 工程执行 | `configuration.md`, `testing.md`, `workflow.md` | 回答“如何配置、如何验证、如何协作”。 |
| 产品模块 | `modules/syncnos-app.md`, `modules/webclipper.md` | 回答“改 App 去哪里、改扩展去哪里”。 |
| 专题页面 | `storage.md`, `release.md`, `troubleshooting.md` | 回答“数据落点、交付链路、故障定位”。 |
| 参考 | `glossary.md`, `GENERATION.md` | 统一术语与生成元数据。 |

## 页面地图（按问题导航）

| 我想回答的问题 | 先读哪里 | 再读哪里 |
| --- | --- | --- |
| 这个仓库到底解决什么问题？ | [business-context.md](business-context.md) | [overview.md](overview.md) |
| App 为什么会先出现引导或付费墙？ | [business-context.md](business-context.md) | [modules/syncnos-app.md](modules/syncnos-app.md) |
| WebClipper 为什么先落本地库再同步？ | [business-context.md](business-context.md) | [data-flow.md](data-flow.md), [storage.md](storage.md) |
| WebClipper 的 Insight 仪表盘读的是什么、本地统计改哪里？ | [modules/webclipper.md](modules/webclipper.md) | [storage.md](storage.md), [configuration.md](configuration.md), [testing.md](testing.md) |
| 我应该改哪个目录？ | [overview.md](overview.md) | [architecture.md](architecture.md), `modules/` |
| 某个数据源 / collector / sync job 影响哪些系统？ | [architecture.md](architecture.md) | [data-flow.md](data-flow.md), [troubleshooting.md](troubleshooting.md) |
| 怎样验证发布不会炸？ | [release.md](release.md) | [configuration.md](configuration.md), [testing.md](testing.md) |

## Coverage Gaps
- **App Store 交付链路**：仓库中能看到 App Store 链接，但没有公开的 App Store 提交 workflow 或脚本；deepwiki 明确把它视为“仓库外渠道信息”。
- **OCR 与键盘焦点专项文档**：仓库已有 `.github/docs/键盘导航与焦点管理技术文档（全项目）.md` 与 `macOS/SyncNos/Services/DataSources-From/OCR/AppleVisionOCR技术文档.md`，本版 deepwiki 已在相关页面引用它们，但尚未继续拆成独立 deepwiki 子页。
- **集成专题页**：当前 Notion / Obsidian / collectors 仍主要分布在 `architecture.md`、`data-flow.md` 与 `modules/` 页面；如果未来这些区域继续膨胀，适合再拆专题页。

## Generation Metadata
- [GENERATION.md](GENERATION.md)
