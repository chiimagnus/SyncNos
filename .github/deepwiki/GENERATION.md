# Generation Metadata

| Field | Value |
| --- | --- |
| Commit hash | `a23304808de60ed280a94d5a6ebc7c1b65b8d737` |
| Branch name | `crh` |
| Generation timestamp | `2026-03-07 02:36:09 CST` |
| Output language | 中文 |
| Generated directory | `deepwiki/` |
| Update mode | Incremental enhancement |
| Copied asset | `Resource/flows.svg` → `deepwiki/assets/repository-flow-01.svg` |

## Generated Pages
- `INDEX.md`
- `overview.md`
- `architecture.md`
- `dependencies.md`
- `data-flow.md`
- `glossary.md`
- `configuration.md`
- `testing.md`
- `workflow.md`
- `storage.md`
- `release.md`
- `troubleshooting.md`
- `modules/syncnos-app.md`
- `modules/webclipper.md`

## New in This Update
- 新增 `storage.md`，集中描述 App 与 WebClipper 的本地持久化、Keychain、IndexedDB、备份格式与迁移策略。
- 新增 `release.md`，拆解 GitHub Release、WebClipper 多渠道打包、AMO / CWS 发布与版本一致性校验。
- 新增 `troubleshooting.md`，把产品线判断、配置误配、存储/发布故障和恢复路径集中到一个排障入口。
- 更新 `INDEX.md`，加入专题页分组与当前仍未细分的 Coverage Gaps。

## Notes
- `deepwiki/` 首版已生成，本次是在升级后的 deepwiki skill 标准下做第二轮增强。
- 页面内容优先依据仓库中的 README、AGENTS、业务说明、构建配置和入口文件整理。
- 后续增量更新时，可沿用本文件记录的提交、分支、页面清单和本次新增专题页作为比较基线。
