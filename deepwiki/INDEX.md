# Deepwiki Index

## 摘要（Summary）
- Purpose: 为 SyncNos 仓库建立一套中文知识入口，帮助读者在不逐层翻源码的前提下理解两条产品线、关键约束和主要工作流。
- Tech stack: Swift 6 / SwiftUI / SwiftData / StoreKit / WXT / React 19 / TypeScript 5.9 / Vitest / GitHub Actions。
- Entry points: `SyncNos/SyncNosApp.swift`、`SyncNos/AppDelegate.swift`、`Extensions/WebClipper/wxt.config.ts`、`Extensions/WebClipper/src/entrypoints/*`。
- Where to start: 先读 [概览](overview.md) 与 [架构](architecture.md)，再按产品线进入对应模块页。
- How to navigate: 仓库级事实在根页面，产品级边界在 `modules/`，工程执行与约束在指南页。

| 产品线 | 首读页面 | 主目录 | 关键入口 |
| --- | --- | --- | --- |
| SyncNos App | [modules/syncnos-app.md](modules/syncnos-app.md) | `SyncNos/` | `SyncNos/SyncNosApp.swift` |
| WebClipper | [modules/webclipper.md](modules/webclipper.md) | `Extensions/WebClipper/` | `Extensions/WebClipper/src/entrypoints/background.ts` |

## 从这里开始（Start Here）
- [概览](overview.md)：仓库目标、目录、入口点与导航方式。
- [架构](architecture.md)：双产品线共享的系统边界、契约与扩展方式。
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

## 参考（Reference）
- [术语表](glossary.md)

## 页面分组（Page Map）
| 分组 | 页面 | 说明 |
| --- | --- | --- |
| 仓库级 | `overview.md`, `architecture.md`, `dependencies.md`, `data-flow.md` | 先建立共同语境，再看产品差异。 |
| 产品级 | `modules/syncnos-app.md`, `modules/webclipper.md` | 分别描述 macOS App 与浏览器扩展。 |
| 指南级 | `configuration.md`, `testing.md`, `workflow.md` | 面向持续维护和协作执行。 |
| 参考级 | `glossary.md` | 统一术语与命名语境。 |

## Generation Metadata
- [GENERATION.md](GENERATION.md)
