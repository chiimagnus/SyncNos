---
name: syncnos-i18n
description: SyncNos 国际化/i18n（Localizable.xcstrings）工作流：翻译规则、参数占位符注意事项，以及 xcstrings 的 compact / split / merge 脚本用法。
---

# SyncNos i18n（xcstrings）

用于处理 SyncNos 的 `Resource/Localizable.xcstrings` 本地化工作。

## 关键约束

- 不要把整个 `Resource/Localizable.xcstrings` 文件内容直接贴进对话（文件很大）；只做定位/统计/脚本处理。
- 默认保持单一 Localizable 表：避免改动大量 `String(localized:)` / `Text(...)` 调用。

## 推荐工作流

1) 需要编辑/翻译时，先定位 key 或原文（用 `rg`/`grep`），再根据 comment 生成翻译。
2) 修改完成后执行 compact，减少 diff 噪音：
   - `python3 .codex/scripts/compact_xcstrings.py`
3) JSON 校验：
   - `python3 -m json.tool Resource/Localizable.xcstrings > /dev/null`

## 拆分成多文件（便于管理）

将大文件拆分到 `.codex/i18n/xcstrings_parts`，再合并回 `Resource/Localizable.xcstrings`：

- 拆分（默认按 key 的第一个分段，例如 `settings.saved` -> `settings`）：
  - `python3 .codex/scripts/xcstrings_split.py --compact`
- 合并回单一文件（默认会检查重复 key）：
  - `python3 .codex/scripts/xcstrings_merge.py --compact`

注意：拆分目录里的 *.xcstrings 不需要加入 Xcode 工程；只把合并产物 `Resource/Localizable.xcstrings` 作为资源文件使用。

## 参考资料

- 详细翻译流程与 sed 模板：`.codex/docs/国际化翻译流程指南.md`

