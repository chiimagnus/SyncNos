# Documentation Ownership

本页只回答三件事：长期事实由哪份文档拥有、什么变化会触发更新、谁会消费它。`.github/features/**` 是实施/审计历史，不是长期产品文档。

## Source baseline

| Field | Value |
| --- | --- |
| Commit hash | `6135434d489c05db86a9e12b95f00a499e6018ff` |
| Reconciled at | `2026-09-14` |

该 commit 是本轮文档核对的源码基线。会频繁变化的版本号、权限列表、schema、默认路径和 browser target 继续由源码、配置和测试拥有。

## Long-term owners

| Owner | Owns | Update when | Consumer |
| --- | --- | --- | --- |
| `README.md`, `README.zh-CN.md` | 用户入口：定位、安装、采集来源、输出目标和文档导航 | 用户可见能力、安装渠道或顶层支持范围变化 | GitHub 项目首页 |
| `PRIVACY.md` | 用户数据、权限、凭据、本地/外部网络边界 | manifest 权限、secret storage/backup exclusion、OAuth 或外部数据流变化 | README、商店隐私审查 |
| `website/content/docs/**` | 面向用户的网站文档：安装、采集范围、Provider 配置、常用功能、CLI 与 FAQ；隐私页只做 `PRIVACY.md` 的用户摘要。官网品牌图标复用 `public/icons/**`，产品截图复用 `docs/assets/**`，由 website build 复制到发布产物 | 用户可见流程、设置字段、支持范围、安装渠道、用户操作或复用资产变化 | GitHub Pages、README、Extension Settings |
| `AGENTS.md`, `src/ui/AGENTS.md` | 维护者/agent 必须提前看到的架构与高风险不变量 | 分层、依赖方向或不可破坏产品/UI 契约变化 | agent rule loader、CONTRIBUTING |
| `skills/syncnos/SKILL.md`, `skills/syncnos-zh/SKILL.md` | AI Agent 使用 `syncnos` 的运行说明 | 命令路由、JSON/error、instance、安装/权限或写入/sync 等调用契约变化 | Repository Skill 使用者 |
| `docs/storage.md` | local-first、一致性、Backup/restore 和失败恢复边界 | IDB/revision、backup/import、asset remap 或 continuity 语义变化 | AGENTS、Privacy、CONTRIBUTING |
| `docs/CONTRIBUTING.md` | 开发、PR 和验证责任 | scripts、CI gate、贡献流程或 manual validation 责任变化 | README、PR template |
| `docs/release.md` | tag/version、npm channel、release preflight、publication ordering 与认证 | release tag 语法、npm/GitHub 发布链、打包 smoke 或 trusted publishing contract 变化 | CONTRIBUTING、release workflow |
| `docs/troubleshooting.md` | 可复用的维护者诊断 | 故障分类、诊断入口或恢复动作变化 | CONTRIBUTING |
| `.github/PULL_REQUEST_TEMPLATE.md`, Issue templates | contributor/reviewer 要提交的 scope、风险和验证证据 | CONTRIBUTING 的证据要求变化 | GitHub PR/Issue UI |
| `docs/GENERATION.md` | 本表与源码核对基线 | owner、职责、trigger/consumer 或全仓 reconciliation 变化 | neat-freak、CONTRIBUTING |

## Rules

- 同一受众的同一长期事实只保留一个详细 owner；其它页面只导航或保留必要的一句高风险 guardrail。
- Runtime 结构、符号、storage key、schema/index、默认目录和 browser 路径由源码/配置/测试回答，不镜像进长期 Markdown。
- README 只做快速用户入口；详细用户操作与 Provider 配置归 `website/content/docs/**`，恢复边界归 storage，完整数据流归 Privacy，验证责任归 CONTRIBUTING。
- 新页面是最后选项；新增时必须同时有长期消费者、明确 edit trigger 和真实导航入口。
