# 为 SyncNos WebClipper 做贡献

SyncNos 欢迎聚焦明确的 Bug 修复、站点适配器、文档改进，以及在不破坏仓库现有契约前提下进行的产品改动。

本仓库**仅维护 SyncNos WebClipper**。

## 开始之前

1. 先搜索现有的 [Issues](https://github.com/chiimagnus/SyncNos/issues) 和 [Pull Requests](https://github.com/chiimagnus/SyncNos/pulls)。
2. 修改代码前先阅读 [`AGENTS.md`](../AGENTS.md)。它是依赖方向、产品不变量和架构专项检查的事实真源。
3. 长期维护的产品与数据模型文档从 [`overview.md`](overview.md) 开始阅读。
4. 在投入实现之前，先讨论非平凡的行为变更。新增站点适配器/集成、存储或 schema 变更、权限变更、迁移以及发布行为，通常都应先有一个达成共识的 Issue。小型文档修改、拼写修正和明显的机械性维护，可以直接提交 PR。
5. 保持改动范围聚焦。不要把无关的清理、格式化、本地化或重构混入功能补丁。

即使一个补丁在技术上是正确的，如果它破坏产品不变量、增加不需要的兼容路径，或超出已约定范围，仍可能被拒绝。

## 本地环境

尽可能使用 Node.js 22，使本地行为与 GitHub Actions 保持一致。

```bash
npm ci
npm run dev
```

如果改动涉及其他受支持的开发目标，可以使用：

```bash
npm run dev:firefox
npm run dev:zen
npm run dev:safari
```

涉及 Safari/Xcode 集成时，应使用仓库脚本，而不是手工维护生成的工程输出：

```bash
npm run setup:safari:xcode
```

当前命令和依赖的事实真源是 [`package.json`](../package.json)。

## 事实真源

不要在这里重复架构规则。依赖方向和产品不变量统一遵循 [`AGENTS.md`](../AGENTS.md)。

长期产品事实应维护在 [`overview.md`](overview.md) 及其链接页面中。版本号、权限、schema、迁移以及其他容易漂移的事实，应保留在各自的 canonical 源文件或唯一的 canonical 文档中；其他文档只应链接过去。

当文档与实现不一致时，先从代码和仓库脚本确认实际行为，然后在同一个 PR 中修正过时文档。

## 提交 Issue

### Bug 报告

有用的 Bug 报告应能让问题复现，并能区分产品缺陷、站点变化和环境问题。请包含：

- 对故障的简短描述；
- 受影响的界面或站点；
- 精确的复现步骤；
- 预期行为和实际行为；
- 操作系统、浏览器及版本，以及 SyncNos 版本或 commit；
- 现有本地数据是否被修改、丢失，或保持完整；
- 如果截图、录屏或日志能显著缩短诊断过程，请一并提供。

附加证据前，请遮盖私人对话内容、账号标识符、Cookie、Access Token、OAuth Secret、API Key，以及导出的备份数据。

### 功能与站点支持请求

先描述用户问题，再提出实现方案。请说明：

- 为什么这个能力应属于 SyncNos；
- 预期工作流和默认行为；
- 范围以及明确的非目标；
- 受影响的浏览器、站点或目标；
- 对存储、权限、隐私、迁移或兼容性的任何影响。

对于站点适配器，请明确支持范围内的页面类型，以及必须采集哪些内容。不要让一个 Issue 覆盖一个边界开放、彼此无关的站点集合。

## Commit

使用 **Conventional Commits**。一个 commit 应只表达一个可验证的关注点。

常见前缀包括：

- `feat:` — 用户可见的新能力；
- `fix:` — 缺陷修复；
- `refactor:` — 不改变行为的结构调整；
- `test:` — 仅测试变更；
- `docs:` — 仅文档变更；
- `chore:` — 仓库维护；
- `ci:` / `build:` — 自动化或构建系统变更。

当 scope 能提供有用上下文时可以添加，例如 `fix(collectors): ...` 或 `feat(settings): ...`。

请写有意义的摘要，不要使用 `-` 之类的占位消息。只有明确的发布/版本自动化才应使用纯版本消息，普通开发 commit 不应如此。当修改原因、兼容性决策或取舍无法从 diff 中直接看出时，应补充 commit body。

示例：

```text
fix(collectors): preserve complete virtualized chat capture
feat(settings): add per-site capture toggle
docs: clarify contributor validation workflow
```

中文或英文摘要都可以；清晰度和可审计性比语言本身更重要。

## Pull Request

PR 应在不依赖作者本地上下文的情况下也能被理解。

- 非平凡行为变更应关联已达成共识的 Issue。文档和明显的机械性维护可填写 `N/A`，并简短说明原因。
- 填写 PR 模板中所有适用部分。对于不适用项应填写 `N/A`，不要直接删除必填说明。
- 说明改动在用户层面或架构层面的原因，而不只是列出修改了哪些文件。
- 明确指出有意设置的非目标、取舍、迁移、权限变更和兼容性决策。
- 更新因本次补丁而过时的 canonical 文档。
- 删除已被替代的生产路径、失效的兼容分支和过时的测试假设，不要留下并行实现。
- 对视觉改动，请使用可比较的状态附上修改前/后的截图或短录屏。
- 补丁尚未准备好接受审查时，请使用 Draft PR。

请求最终审查前，应让分支保持与 `main` 同步，并解决冲突。

## 审查前验证

仓库脚本定义了验收门槛：

| 变更 | 必需的本地验证 |
| --- | --- |
| 常规代码改动 | 开发期间运行 `npm run compile` 和 `npm run test` |
| 代码 PR 准备接受审查 | `npm run gate:ci` |
| 仅文档 / GitHub 模板变更 | 如果没有修改运行时、构建或依赖文件，`gate:ci` 可以填写 `N/A`；需在 PR 中说明原因 |
| 生产构建、manifest、权限、打包或发布变更 | `npm run gate` |
| 浏览器/站点专项行为 | 手动验证受影响的浏览器/站点路径；适用时运行对应的 `dev:*` / build 命令 |
| 视觉行为 | 记录受影响状态的修改前/后效果，或提供等价截图 |

对于触及 WebClipper 代码路径的非 Draft PR，GitHub Actions 当前会运行 `npm ci` 和 `npm run gate:ci`。该 CI 结果**不能**替代要求的本地 production build 或手动浏览器验证。

当改动涉及 [`AGENTS.md`](../AGENTS.md) 中的产品不变量时，请在 PR 中提供相应的架构专项扫描或定向测试证据。

## 数据与隐私变更

SyncNos 采用 local-first，因此涉及 IndexedDB、备份/恢复、同步映射、OAuth、缓存图片、权限或迁移的改动，都需要明确审查失败路径。请说明外部目标失败时会发生什么，以及现有本地数据如何保持可恢复。

不要提交真实凭据、私人用户内容、浏览器 profile、包含个人数据的生成备份归档，或采集到的 session 材料。

## 许可证

接受到本仓库中的贡献将按照仓库的 [GNU Affero General Public License v3](../LICENSE.APGLv3) 分发。
