# Deepwiki Index

## 摘要（Summary）
- Purpose: 为 SyncNos 仓库建立一套中文知识入口，帮助读者在不逐层翻源码的前提下理解两条产品线、关键约束和主要工作流。
- Tech stack: Swift 6 / SwiftUI / SwiftData / StoreKit / WXT / React 19 / TypeScript 5.9 / Vitest / GitHub Actions。
- Entry points: `SyncNos/SyncNosApp.swift`、`SyncNos/AppDelegate.swift`、`Extensions/WebClipper/wxt.config.ts`、`Extensions/WebClipper/src/entrypoints/*`。
- Where to start: 先读 [概览](overview.md) 与 [架构](architecture.md)，再按产品线进入对应模块页；排障、数据落点与发布问题分别进入专题页。
- How to navigate: 仓库级事实在根页面，产品级边界在 `modules/`，工程执行与约束在指南页，数据/发布/排障集中在专题页。

| 产品线 | 首读页面 | 主目录 | 关键入口 |
| --- | --- | --- | --- |
| SyncNos App | [modules/syncnos-app.md](modules/syncnos-app.md) | `SyncNos/` | `SyncNos/SyncNosApp.swift` |
| WebClipper | [modules/webclipper.md](modules/webclipper.md) | `Extensions/WebClipper/` | `Extensions/WebClipper/src/entrypoints/background.ts` |

## 从这里开始（Start Here）
- [概览](overview.md)：仓库目标、目录、入口点与导航方式。
- [架构](architecture.md)：双产品线共享的系统边界、契约与扩展方式。
- [数据流](data-flow.md)：理解“来源 → 本地缓存 / 本地库 → Notion / Obsidian / 导出”的主链路。
- [工作流](workflow.md)：按产品线拆分的开发、文档与发布流程。

## 核心页面（Core Pages）
- [依赖关系](dependencies.md)
- [数据流](data-flow.md)
- [配置](configuration.md)
- [测试](testing.md)

## 模块（Modules）
- [模块：SyncNos App](modules/syncnos-app.md)
- [模块：WebClipper](modules/webclipper.md)

## 指南（Guides）
- [工作流](workflow.md)
- [配置](configuration.md)
- [测试](testing.md)

## 专题（Topics）
- [存储](storage.md)
- [发布](release.md)
- [故障排查](troubleshooting.md)

## 参考（Reference）
- [术语表](glossary.md)

## 页面分组（Page Map）
| 分组 | 页面 | 说明 |
| --- | --- | --- |
| 仓库级 | `overview.md`, `architecture.md`, `dependencies.md`, `data-flow.md` | 先建立共同语境，再看产品差异。 |
| 产品级 | `modules/syncnos-app.md`, `modules/webclipper.md` | 分别描述 macOS App 与浏览器扩展。 |
| 指南级 | `configuration.md`, `testing.md`, `workflow.md` | 面向持续维护和协作执行。 |
| 专题级 | `storage.md`, `release.md`, `troubleshooting.md` | 面向“数据落点”“版本交付”“排障定位”三类高价值问题。 |
| 参考级 | `glossary.md` | 统一术语与命名语境。 |

## Coverage Gaps（如有）
- 当前 deepwiki 已覆盖仓库级、模块级与专题级核心语境，但还没有继续拆出 Notion 集成、OCR 流程和 WebClipper collectors 的独立子页面。
- 当后续需要更细粒度的修改导航时，可继续把 `modules/` 下的产品线页面拆成同步、存储、集成等子模块页。

## Generation Metadata
- [GENERATION.md](GENERATION.md)
