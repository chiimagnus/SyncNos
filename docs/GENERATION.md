# Documentation Ownership

本页只回答三件事：长期事实由哪份文档拥有、什么变化会触发更新、谁会消费它。`.github/features/**` 是实施/审计历史，不是长期产品文档。

## Source baseline

| Field | Value |
| --- | --- |
| Commit hash | `da8563456dcc0d7b419099e229f69c075078d624` |
| Reconciled at | `2026-10-03` |

该 commit 是本轮文档核对的源码基线。会频繁变化的版本号、权限列表、schema、默认路径和 browser target 继续由源码、配置和测试拥有。

## Long-term owners

| Owner | Owns | Update when | Consumer |
| --- | --- | --- | --- |
| `README.md`, `README.zh-CN.md` | 用户入口：定位、安装、采集来源、输出目标和文档导航 | 用户可见能力、安装渠道或顶层支持范围变化 | GitHub 项目首页 |
| `PRIVACY.md` | 用户数据、权限、凭据、本地/外部网络边界 | manifest 权限、secret storage/backup exclusion、OAuth 或外部数据流变化 | README、商店隐私审查 |
| `website/content/docs/**` | 面向用户的网站文档：用户任务导航、功能发现、安装、采集、使用与整理、同步、导出/备份、CLI 与 FAQ；隐私页只做 `PRIVACY.md` 的用户摘要。官网品牌图标复用 `public/icons/**`，产品截图复用 `docs/assets/**`，由 website build 复制到发布产物 | 用户可见能力/入口、导航分组、操作流程、设置字段、支持范围、安装渠道或复用资产变化 | GitHub Pages、README、Extension Settings |
| `website/llms.txt` | 面向 LLM / Agent 的官网级产品能力摘要与主要文档入口，不复制具体操作步骤 | 顶层用户可见能力、支持范围或主要文档入口变化 | 官网 `llms.txt` 消费者 |
| `AGENTS.md`, `src/ui/AGENTS.md` | 维护者/agent 必须提前看到的架构与高风险不变量 | 分层、依赖方向或不可破坏产品/UI 契约变化 | agent rule loader、CONTRIBUTING |
| `skills/syncnos/SKILL.md`, `skills/syncnos-zh/SKILL.md` | AI Agent 使用 `syncnos` 的运行说明 | 命令路由、JSON/error、instance、安装/权限或写入/sync 等调用契约变化 | Repository Skill 使用者 |
| `docs/storage.md` | local-first、一致性、Backup/restore 和失败恢复边界 | IDB/revision、backup/import、asset remap 或 continuity 语义变化 | AGENTS、Privacy、CONTRIBUTING |
| `docs/CONTRIBUTING.md` | 开发、PR 和验证责任 | scripts、CI gate、贡献流程或 manual validation 责任变化 | README、PR template |
| `docs/release.md` | tag/version、npm channel、release preflight、publication ordering 与认证 | release tag 语法、npm/GitHub 发布链、打包 smoke 或 trusted publishing contract 变化 | CONTRIBUTING、release workflow |
| `docs/troubleshooting.md` | 可复用的维护者诊断 | 故障分类、诊断入口或恢复动作变化 | CONTRIBUTING |
| `.github/PULL_REQUEST_TEMPLATE.md`, Issue templates | contributor/reviewer 要提交的 scope、风险和验证证据 | CONTRIBUTING 的证据要求变化 | GitHub PR/Issue UI |
| `docs/GENERATION.md` | 本表与源码核对基线 | owner、职责、trigger/consumer 或全仓 reconciliation 变化 | neat-freak、CONTRIBUTING |

## Rules

- 同一受众的同一长期事实只保留一个详细 owner；其它页面只导航或保留必要 guardrail。
- Runtime 结构、storage key、schema、默认目录和 browser path 由源码/配置/测试回答，不镜像进长期文档。
- README 只做入口；用户操作归 `website/content/docs/**`，恢复归 `storage.md`，数据流归 `PRIVACY.md`，验证责任归 `CONTRIBUTING.md`。
- 用户文档按用户任务组织，只保留必要步骤、结果、限制和排障；维护者文档只保留长期不变量、失败语义、ownership 和验证入口。新页面是最后选项。
