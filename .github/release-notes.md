# Release Notes Prompt

用于 stable GitHub Release 发布后，由 AI 补充面向普通用户的中英文摘要。

## Prompt

请更新当前版本的 GitHub Release Notes。

先核对上一个 stable tag 到当前 tag 的 merged PR、commits，并在必要时查看实际代码。然后：

- 只写普通用户能感知的新增、改进和重要修复；忽略重构、测试、CI、依赖和内部整理。
- 同一功能的多个 PR / commit 合并成一项，按用户价值排序。
- 简明具体，不使用内部模块名或开发流水账。
- 中英文表达同一组事实，中文在前。
- 不删除或改写现有商店 badge 和 GitHub 自动生成的变更记录。

使用：

```md
## 中文

- ...

## English

- ...
```

直接编辑 Release，不输出分析过程。
