#!/usr/bin/env python3
"""
Localizable.xcstrings 格式压缩脚本

目的：
- 将 `localizations` 下每种语言的 `stringUnit` 压缩为单行
- 将语言条目压缩为单行
- 写回后进行 JSON 校验，避免格式化过程中破坏文件

用法：
    # 默认：压缩 Resource/ 目录下所有 *.xcstrings
    python3 .codex/skills/syncnos-i18n/scripts/compact_xcstrings.py

    # 指定一个或多个文件路径
    python3 .codex/skills/syncnos-i18n/scripts/compact_xcstrings.py path/to/A.xcstrings path/to/B.xcstrings
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def _find_repo_root(start: Path) -> Path | None:
    for parent in [start] + list(start.parents):
        if (parent / "Resource" / "Localizable.xcstrings").exists():
            return parent
        if (parent / "SyncNos.xcodeproj").exists() and (parent / "Resource").exists():
            return parent
    return None


def compact_xcstrings(file_path: Path) -> None:
    content = file_path.read_text(encoding="utf-8")

    # 处理前验证 JSON 格式
    data = json.loads(content)

    # 第一步：标准化输出（保持 key 分隔符为 ` : `，贴近仓库风格）
    output = json.dumps(data, ensure_ascii=False, indent=2, separators=(",", " : "))

    # 第二步：将 stringUnit 块压缩为单行
    string_unit_pattern = (
        r'"stringUnit"\s*:\s*\{\s*\n'
        r'\s*"state"\s*:\s*"([^"]+)"\s*,\s*\n'
        r'\s*"value"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\n'
        r"\s*\}"
    )

    def string_unit_replacer(match: re.Match[str]) -> str:
        state = match.group(1)
        value = match.group(2)
        return f'"stringUnit" : {{ "state" : "{state}", "value" : "{value}" }}'

    output = re.sub(string_unit_pattern, string_unit_replacer, output)

    # 第三步：将语言条目压缩为单行
    lang_pattern = (
        r'"([a-z]{2}(?:-[A-Za-z]+)?)"\s*:\s*\{\s*\n'
        r'\s*("stringUnit" : \{ "state" : "[^"]+", "value" : "[^"\\]*(?:\\.[^"\\]*)*" \})\s*\n'
        r"\s*\}"
    )

    def lang_replacer(match: re.Match[str]) -> str:
        lang = match.group(1)
        string_unit = match.group(2)
        return f'"{lang}" : {{ {string_unit} }}'

    output = re.sub(lang_pattern, lang_replacer, output)

    file_path.write_text(output, encoding="utf-8")

    # 处理后验证 JSON 格式
    json.loads(file_path.read_text(encoding="utf-8"))


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = _find_repo_root(script_dir) or Path.cwd()
    resource_dir = repo_root / "Resource"

    if len(sys.argv) > 1:
        file_paths = [Path(arg).expanduser().resolve() for arg in sys.argv[1:]]
    else:
        file_paths = sorted(resource_dir.glob("*.xcstrings"))

    if not file_paths:
        print(f"错误: 未找到任何 .xcstrings 文件（{resource_dir}）", file=sys.stderr)
        return 1

    for file_path in file_paths:
        if not file_path.exists():
            print(f"错误: 文件不存在: {file_path}", file=sys.stderr)
            return 1

        print(f"正在压缩: {file_path}")

        try:
            compact_xcstrings(file_path)
        except json.JSONDecodeError as exc:
            print(f"错误: JSON 格式无效 - {exc}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"错误: {exc}", file=sys.stderr)
            return 1

    print("✅ 完成 - xcstrings 文件压缩成功")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
