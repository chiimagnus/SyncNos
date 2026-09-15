# Release Notes Prompt

用于 stable GitHub Release 发布后，由 AI 补充面向普通用户的版本摘要。

## Prompt

请更新当前版本的 GitHub Release Notes。

先核对上一个稳定版 tag 到当前 tag 之间的真实变更，重点读取：

- merged PR 的 title 与 description
- commits
- 必要时核对实际代码，避免把未实际交付的内容写进 Release

然后在现有 Release 顶部补充面向普通用户的版本摘要：

- 只写用户能感知的新增功能、体验改进和重要修复
- 同一功能涉及的多个 PR / commit 合并为一项
- 条数不设固定限制，以完整覆盖有价值的用户可见变化为准
- 变化较多时可按 `New` / `Improved` / `Fixed` 自然分组；不需要分组时不要强行分组
- 每项简明具体，使用普通用户能理解的语言
- 忽略重构、测试、CI、依赖升级、代码整理和其他内部实现变化
- 不使用内部模块名、commit 术语或开发流水账表达
- 不夸大，不写实际没有交付的能力
- 按用户价值排序
- 使用简洁英文，与 GitHub Release 页面保持一致

保留现有商店 badge 和 `<details><summary>Full changelog</summary>...</details>` 原样不动；只在它们之间插入或更新用户摘要。不要删除或改写 `Full changelog` 中 GitHub 自动生成的原始记录。

直接完成 Release 编辑，不输出分析过程。
