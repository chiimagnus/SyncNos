# 为 SyncNos WebClipper 做贡献

代码架构与不可破坏契约见 [`AGENTS.md`](../AGENTS.md)；本页只负责贡献流程和验证责任。

## 开始之前

1. 先搜索现有 [Issues](https://github.com/chiimagnus/SyncNos/issues) 和 [Pull Requests](https://github.com/chiimagnus/SyncNos/pulls)。
2. 修改代码前阅读 [`AGENTS.md`](../AGENTS.md)；改 UI 时同时阅读 [`src/ui/AGENTS.md`](../src/ui/AGENTS.md)。
3. 非平凡行为、权限、存储/迁移、发布流程或新集成先在 Issue 说明范围；明显小修和文档修正可直接提 PR。
4. 保持补丁聚焦，不混入无关重构和兼容层。

## 本地开发

CI 使用 Node.js 22：

```bash
npm ci
npm run dev
```

`dev*` 会先运行 `npm run cli:link`，因此开发中的 `syncnos` 直接使用当前 `cli/`。其它目标和命令以 [`package.json`](../package.json) 为准。

Safari/Xcode 集成使用 `npm run setup:safari:xcode`。排障见 [`troubleshooting.md`](troubleshooting.md)。

## Pull Request

- 说明问题、实际范围和明确非目标，不只列文件名。
- 指出数据迁移、权限、兼容性或恢复语义变化；没有则写 `N/A`。
- 同一 PR 更新被改动影响的 canonical 文档，并删除被替代的旧路径。
- 视觉改动提供可比较的截图或短录屏。
- 未准备好最终审查时使用 Draft PR。

## 验证

开发时先跑最相关的定向测试；准备 review 时按影响范围完成最低 gate：

| 改动 | 最低验证 |
| --- | --- |
| Markdown / GitHub 模板 | `npm run format:check` + 修改过的本地链接检查 |
| 用户 Docs | `npm run website:build` + `npm run format:check` + 在真实浏览器打开所有修改页面；导航/信息架构改动还要逐个检查受影响的中英文正式 route |
| 常规代码 | `npm run gate:ci` |
| production build、manifest、权限、打包或发布 | `npm run gate` |
| CLI / installer / Native Messaging | `npm run gate` + `npm run cli:check`，并在受影响 OS 做真实 discovery/read-back |
| 浏览器、站点或视觉行为 | 手动走通受影响的真实路径，并记录用户可观察结果；AI 对话按 [`ai-chat-testing.md`](ai-chat-testing.md) 执行统一回归 |

`npm run gate` 比 `gate:ci` 多构建 Chromium production artifact 并执行 `check:dist`。Zen / Safari 有改动时再运行 `npm run check:zen` / `npm run check:safari`。模拟平台测试不能冒充真实平台 E2E。

## 数据、权限与隐私

修改 IndexedDB、Backup、sync mapping、OAuth、图片缓存、权限、Native Messaging 或迁移时，必须说明失败后如何保持数据可恢复，以及是否新增本地到外部的数据流。

长期数据契约见 [`storage.md`](storage.md)，用户数据流见 [`../PRIVACY.md`](../PRIVACY.md)。不要提交真实凭据、私人用户内容、浏览器 Profile、Backup 或 session 材料。

## 发布与文档

Release 契约见 [`release.md`](release.md)。长期文档归属和更新触发见 [`GENERATION.md`](GENERATION.md)；`.github/features/**` 只保存实施/审计历史。

## 许可证

接受到本仓库中的贡献按 [GNU Affero General Public License v3](../LICENSE.APGLv3) 分发。
