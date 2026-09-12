# Documentation Ownership

本页定义 SyncNos 长期文档的职责、更新触发条件与证据入口。它不是产品指南，也不复制源码结构。`.github/features/**` 属于实施计划/审计历史，不是长期产品文档。

## Source baseline

| Field | Value |
| --- | --- |
| Repository | `SyncNos` WebClipper (`chiimagnus/SyncNos`) |
| Commit hash | `cefb5ea0af9932d9d927b460dc00131bde2faf5a` |
| Reconciled at | `2026-09-08` |

该 commit 是本轮长期文档核对的源码基线；本轮后续仅文档提交不改变这条“已核对源码”的证据含义。会漂移的版本号、权限、schema、provider 默认值继续由源码/配置/测试拥有，不在本页复制。

## Long-term owners

| Owner | Audience / job | Edit trigger & evidence | Consumer / enforcement |
| --- | --- | --- | --- |
| `README.md`, `README.zh-CN.md` | 用户入口：产品定位、支持来源/输出、安装与导航 | 用户可见来源、输出目标、安装渠道或顶层能力变化；来源列表以 `src/collectors/ai-chat-sites.ts` 和真实 provider/export 入口核对 | GitHub 项目首页；链接到 provider guide、Privacy、storage、CONTRIBUTING |
| `AGENTS.md`, `src/ui/AGENTS.md` | agent/维护者在改代码前必须看到的分层与不可破坏不变量 | 分层、跨层依赖、高风险产品 invariant、UI token/交互 guardrail 变化；由源码、架构扫描和 enforcing tests 证明 | agent rule loader；README/CONTRIBUTING 导航 |
| `PRIVACY.md` | 用户：权限、凭据、本地/外部数据流与第三方边界 | manifest/host permission、OAuth 模式、secret storage/backup exclusion、外部网络目标或本地→远端数据范围变化；核对 `wxt.config.ts`、provider auth/network、backup filtering | README；发布/商店隐私声明 |
| `docs/storage.md` | 维护者：local-first、一致性、备份/恢复、失败语义 | IDB/revision、canonical read、backup/import、asset remap、continuity/恢复边界变化；核对 storage/backup 源码与 migration/revision/backup tests | `AGENTS.md`、README Backup 入口、PRIVACY、CONTRIBUTING 的数据审查要求 |
| `docs/CONTRIBUTING.md` | 贡献者：开发工作流、提交/PR 和验证责任 | package scripts、CI gate、贡献流程、manual validation 或文档治理责任变化；以 `package.json`、workflows、PR/Issue templates 为证据 | README、AGENTS、PR template、issue flow |
| `docs/troubleshooting.md` | 维护者：可复用故障诊断，不拥有产品契约 | 消息生命周期、OAuth/发布、provider 同步失败/恢复诊断、Zen 流程变化；以对应源码、脚本和 regression tests 为证据 | CONTRIBUTING |
| Feishu EN/ZH setup guides | 用户：配置飞书 OAuth/DocX 同步 | OAuth redirect/scope、Direct/Proxy 模式、Settings 字段或必要用户步骤变化；以 Feishu auth/Settings 源码与 tests 为证据 | README；Settings 的 “Open Setup Guide” |
| Obsidian EN/ZH setup guides | 用户：配置 Local REST API | transport 支持、默认 endpoint/header、Settings 字段或必要插件步骤变化；以 Obsidian settings/client 源码与 tests 为证据 | README；Settings 的 “Open Setup Guide” |
| `.github/scripts/webclipper/STORE_LISTING_COPY.md` | 发布维护者：浏览器商店长/短文案的人工 source copy | 用户可见来源/输出能力、隐私声明或商店文案变化；与 README/Privacy 对照。localized manifest 描述另由 `public/_locales/*/messages.json` 拥有，长度由仓库脚本校验 | 人工商店发布流程；不是 workflow 自动上传输入 |
| `.github/PULL_REQUEST_TEMPLATE.md`, Issue templates | contributor/reviewer：收集 scope、风险与验证证据 | CONTRIBUTING 的提交证据要求变化时同步 | GitHub PR/Issue UI |
| `docs/GENERATION.md` | 维护者：本表自身与源码核对基线 | 长期 owner 增删/合并、职责/edit trigger/consumer 变化，或执行一次新的全仓文档 reconciliation | neat-freak 基线读取；CONTRIBUTING 文档维护入口 |

## Governance rules

- 同一受众的同一长期事实只保留一个详细 owner；其它页面导航或保留必要的一句 guardrail，不复制第二套实现清单。
- Runtime 结构、符号、caller、storage key、schema/index 名、provider 默认目录等由源码/CodeGraph/测试回答，不长期镜像到 Markdown。
- provider 用户配置属于对应 guide；内部同步生命周期与数据恢复边界分别由源码/测试和 `docs/storage.md` 负责。
- README 只做五分钟入口，不承担 provider 详细配置、迁移历史或内部协议。
- 新页面是最后选项：只有现有 owner 无法承载一个长期、有消费者、有明确 edit trigger 的契约时才新增，并在同一改动接入真实导航。
- 删除/替代 owner 时同次清理旧链接和重复说明；Git 历史与 `.github/features/**` 保存实施过程，不把 rejected idea 或一次性验证结果搬进长期 docs。
