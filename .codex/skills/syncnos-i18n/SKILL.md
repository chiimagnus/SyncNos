---
name: syncnos-i18n
description: "SyncNos 的 i18n（Localizable.xcstrings）工作流：定位 key、添加/更新翻译、JSON 校验、可选压缩格式（stringUnit/语言块单行）。"
metadata:
  short-description: SyncNos i18n workflow
---

# SyncNos i18n（Localizable.xcstrings）

适用场景：
- 需要为 `Resource/Localizable.xcstrings` 新增/更新翻译
- 希望通过脚本把 `stringUnit`/语言块压缩为单行，并保持 JSON 合法

## 快速流程（推荐）

1) 定位字符串 key

```bash
rg -n --fixed-strings '"目标字符串"' Resource/Localizable.xcstrings
```

2) 查看上下文（尤其是 `comment`）

```bash
sed -n '行号,行号+20p' Resource/Localizable.xcstrings
```

3) 添加/更新翻译

- 小改动：直接编辑 `Resource/Localizable.xcstrings`
- 批量：用 `sed -i ''`（macOS）插入 `localizations` 块（示例见 `references/i18n-translation-workflow.md`）

4) 校验 JSON

```bash
python3 -m json.tool Resource/Localizable.xcstrings > /dev/null && echo "✅ JSON valid"
```

5) 可选：压缩格式（并自动校验）

```bash
python3 .codex/skills/syncnos-i18n/scripts/compact_xcstrings.py
```

## 支持语言（16 种）

| code | language |
| --- | --- |
| `en` | English |
| `zh-Hans` | 简体中文 |
| `da` | Danish |
| `nl` | Dutch |
| `fi` | Finnish |
| `fr` | French |
| `de` | German |
| `id` | Indonesian |
| `ja` | Japanese |
| `ko` | Korean |
| `pt-BR` | Portuguese (Brazil) |
| `ru` | Russian |
| `es` | Spanish |
| `sv` | Swedish |
| `th` | Thai |
| `vi` | Vietnamese |

## 常见问题

### JSON 验证失败

- 检查引号、逗号是否配对（尤其是最后一个条目后不应有逗号）
- 遇到特殊字符时，优先先手工编辑/粘贴再校验；批量 `sed` 时参考转义规则（见 `references/i18n-translation-workflow.md`）

### 回滚错误修改

```bash
git restore -- Resource/Localizable.xcstrings
```

