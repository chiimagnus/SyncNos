# 为 SyncNos WebClipper 做贡献

本仓库维护 WebClipper 及其本机 `syncnos` CLI / Native Messaging host。代码架构和不可破坏契约见 [`AGENTS.md`](../AGENTS.md)；本页只负责贡献流程和验证责任。

## 开始之前

1. 搜索现有 [Issues](https://github.com/chiimagnus/SyncNos/issues) 和 [Pull Requests](https://github.com/chiimagnus/SyncNos/pulls)。
2. 修改代码前阅读 [`AGENTS.md`](../AGENTS.md)；改 UI 时同时阅读 [`src/ui/AGENTS.md`](../src/ui/AGENTS.md)。
3. 非平凡行为、权限、存储/schema、迁移、发布流程或新集成，先在 Issue 中把范围说清楚。明显的小修和文档修正可直接提 PR。
4. 保持补丁聚焦；不要混入无关重构、格式化或兼容层。

## 本地开发

使用 Node.js 22 与 CI 保持一致：

```bash
npm ci
npm run dev
```

其它开发目标：

```bash
npm run dev:firefox
npm run dev:zen
npm run dev:safari
```

CLI：

```bash
npm run cli:dev -- --help
npm run cli:check
npm run cli:pack
```

Safari/Xcode 集成使用仓库脚本生成：

```bash
npm run setup:safari:xcode
```

命令和依赖以 [`package.json`](../package.json) 为准。环境、OAuth、消息生命周期、CLI 和 Zen 排障见 [`troubleshooting.md`](troubleshooting.md)。

## Pull Request

PR 应让不掌握作者本地上下文的人也能判断改动是否正确：

- 非平凡行为变更关联已达成共识的 Issue；允许直接提交的改动可写 `N/A — <reason>`。
- 说明为什么要改、实际范围和明确非目标，不要只列文件名。
- 指出数据迁移、权限、兼容性或恢复语义的变化；没有则写 `N/A`。
- 同一补丁中更新已经过时的 canonical 文档，并删除被替代的生产路径、兼容分支和旧测试假设。
- 视觉改动提供可比较的前后截图或短录屏。
- 未准备好接受最终审查时使用 Draft PR。

## 验证

开发过程中先跑最相关的定向测试；准备 review 时按影响范围完成下面的 gate：

| 改动 | 最低验证 |
| --- | --- |
| 仅 Markdown / GitHub 模板 | `npm run format:check`，并检查修改过的本地链接 |
| 用户 Docs 内容 / 导航（`website/content/docs/**`） | `npm run website:build`；在真实浏览器渲染所有修改页面。涉及导航/信息架构时，逐个走完所有受影响的中英文正式 route，并核对重要功能仍有可发现入口 |
| 常规代码 PR | `npm run gate:ci` |
| production build、manifest、权限、打包或发布 | `npm run gate` |
| CLI package / installer / Native Messaging | `npm run gate` + `npm run cli:check`；对受影响 OS 验证 manifest/Registry/IPC 契约，并在可用平台做真实 discovery/read-back |
| 浏览器或站点专项行为 | 手动走通受影响的真实浏览器/站点路径 |
| 官网 / GitHub Pages 布局与样式改动 | `npm run website:build`，并在 push 前通过本地 HTTP 以 `/SyncNos/` Pages 路径在真实浏览器渲染首页与受影响 Docs；检查受影响的深浅色、导航与滚动状态 |
| 视觉行为 | 记录受影响状态的前后效果 |

模拟平台测试只能证明对应契约，不应写成真实 Windows/Linux/浏览器 E2E。CI 对 WebClipper 代码运行 `npm run gate:ci`；绿色 CI 不能替代要求的 production build 或手动验证。

触及 [`AGENTS.md`](../AGENTS.md) 中的不变量时，在 PR 中附上对应的定向测试或架构扫描证据。

## 发布

CLI 与 Extension 共用同一个 release tag/version。正常 release 由 Git tag 触发 `.github/workflows/release.yml`：完成 preflight、canonical gate、CLI tarball install smoke 后，通过 npm Trusted Publishing/OIDC 自动发布 `@chiimagnus/syncnos`，read-back exact version + dist-tag 成功后才创建 GitHub Release。完整 version/channel、恢复与 publication ordering 契约见 [`release.md`](release.md)。

## 数据、权限与隐私

修改 IndexedDB、Backup、sync mapping、OAuth、图片缓存、权限、Native Messaging 或迁移时，必须说明失败/重试后本地数据如何保持可恢复，以及是否新增本地到外部的数据流。

长期数据与恢复契约见 [`storage.md`](storage.md)，用户隐私与网络边界见 [`../PRIVACY.md`](../PRIVACY.md)。不要提交真实凭据、私人用户内容、浏览器 Profile、含个人数据的 Backup 或 session 材料。

## 文档

长期文档的职责和更新触发条件见 [`GENERATION.md`](GENERATION.md)。优先更新已有 owner；`.github/features/**` 只保存实施计划和审计证据，不作为长期产品文档。

## 许可证

接受到本仓库中的贡献按 [GNU Affero General Public License v3](../LICENSE.APGLv3) 分发。
