# 仓库指南

SyncNos WebClipper 是一个基于 WebExtensions（MV3）的浏览器扩展：抓取网页/AI 对话并保存到本地数据库，支持导出/备份/恢复，以及**手动**同步到 Notion / Obsidian。默认 local-first，不在后台自动把内容推到 Notion。

## 项目结构

- `webclipper/src/ui/**`：UI（popup/app/inpage），只放组件/样式/DOM 面板
- `webclipper/src/viewmodels/**`：ViewModel（hooks/context），只做 UI 状态编排与调用 service
- `webclipper/src/services/**`：Service（用例/业务流程），承接平台交互与业务逻辑
- `webclipper/src/platform/**`：平台适配（runtime/ports/storage/webext 等）
- `webclipper/src/collectors/**`：站点采集规则（content-side DOM 解析）

## 分层与依赖方向（强约束）

- 依赖方向：`ui -> viewmodels -> services -> (platform, domain, client, sync, shared, ...)`
- 禁止反向依赖：`services` 不得 import `ui/viewmodels`
- 禁止平台直连：`ui/**` 与 `viewmodels/**` 不得 import `platform/**`
- 业务与 UI 解耦：可复用业务算法/数据处理必须下沉到 `services/**`（或更底层的 domain/client 模块）

边界自检（手动）：

- `rg -n "src/platform|/platform/" webclipper/src/ui`
- `rg -n "src/platform|/platform/" webclipper/src/viewmodels`

## TypeScript 路径别名（约定）

> 目的：减少重排过程中的 `../../..`，并保证 `tsc` / WXT(Vite) / Vitest / IDE 解析一致。

- `@ui/*` -> `webclipper/src/ui/*`
- `@viewmodels/*` -> `webclipper/src/viewmodels/*`
- `@services/*` -> `webclipper/src/services/*`
- `@platform/*` -> `webclipper/src/platform/*`
- `@collectors/*` -> `webclipper/src/collectors/*`
- `@entrypoints/*` -> `webclipper/src/entrypoints/*`
- `@i18n/*` -> `webclipper/src/ui/i18n/*`

自检（手动）：

- `rg -n "@platform/" webclipper/src/ui webclipper/src/viewmodels`

## 重构期间的 bug 记录

- 仅记录、默认不在本次重构中顺手修复：
  - `.github/features/webclipper-layered-refactor/bugfix.md`

## 开发与验证

```bash
npm --prefix webclipper install
npm --prefix webclipper run dev          # WXT 开发（Chrome）
npm --prefix webclipper run compile      # tsc --noEmit
npm --prefix webclipper run test         # vitest（如存在）
npm --prefix webclipper run build        # 构建产物
npm --prefix webclipper run check        # 产物校验（manifest/icons 等）
```

## 贡献约定

- 默认不查看、不编辑 i18n 字段（除非明确要求）。
- Commit message 用 Conventional Commits（如 `refactor:`/`feat:`/`fix:`），一次改动尽量做到可编译、可回滚。
- 重构优先拆成可独立验证的小步：每步至少跑 `npm --prefix webclipper run compile`。
