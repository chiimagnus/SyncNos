#!/usr/bin/env python3
"""
Localizable.xcstrings 格式压缩脚本

将 xcstrings 文件中的常见多行结构压缩为更紧凑的单行格式，
减少 diff 噪音并提升可读性。

使用方法:
    # 默认处理 Resource/Localizable.xcstrings
    python3 .codex/scripts/compact_xcstrings.py

    # 处理指定文件（可多个）
    python3 .codex/scripts/compact_xcstrings.py Resource/Localizable.xcstrings other.xcstrings

    # 处理目录（递归寻找 *.xcstrings）
    python3 .codex/scripts/compact_xcstrings.py .codex/i18n/xcstrings_parts
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


_STRING_UNIT_PATTERN = re.compile(
    r'"stringUnit"\s*:\s*\{\s*\n'
    r'\s*"state"\s*:\s*"([^"]+)",\s*\n'
    r'\s*"value"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\n'
    r'\s*\}',
    re.MULTILINE,
)

_LANG_ENTRY_PATTERN = re.compile(
    r'"([a-z]{2}(?:-[A-Za-z]+)?)"\s*:\s*\{\s*\n'
    r'\s*("stringUnit"\s*:\s*\{\s*"state"\s*:\s*"[^"]+",\s*"value"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*\})\s*\n'
    r'\s*\}',
    re.MULTILINE,
)


def _compact_xcstrings_text(data: dict) -> str:
    output = json.dumps(data, ensure_ascii=False, indent=2)

    def string_unit_replacer(match: re.Match) -> str:
        state = match.group(1)
        value = match.group(2)
        return f'"stringUnit" : {{ "state" : "{state}", "value" : "{value}" }}'

    output = _STRING_UNIT_PATTERN.sub(string_unit_replacer, output)

    def lang_replacer(match: re.Match) -> str:
        lang = match.group(1)
        string_unit = match.group(2)
        string_unit = re.sub(r'"stringUnit"\s*:\s*', '"stringUnit" : ', string_unit)
        return f'"{lang}": {{ {string_unit} }}'

    output = _LANG_ENTRY_PATTERN.sub(lang_replacer, output)

    return output + "\n"


def compact_xcstrings(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        output = _compact_xcstrings_text(data)
        path.write_text(output, encoding="utf-8")

        with path.open("r", encoding="utf-8") as f:
            json.load(f)

        return True
    except json.JSONDecodeError as e:
        print(f"错误: JSON 格式无效 - {path}: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"错误: {path}: {e}", file=sys.stderr)
        return False


def _expand_paths(args: list[str], repo_root: Path) -> list[Path]:
    if not args:
        return [repo_root / "Resource" / "Localizable.xcstrings"]

    expanded: list[Path] = []
    for raw in args:
        path = Path(raw)
        if path.is_dir():
            expanded.extend(sorted(path.rglob("*.xcstrings")))
        else:
            expanded.append(path)

    return [p for p in expanded if p.exists()]


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    targets = _expand_paths(sys.argv[1:], repo_root)

    if not targets:
        print("错误: 未找到任何 xcstrings 文件", file=sys.stderr)
        sys.exit(1)

    failures: list[Path] = []
    for target in targets:
        print(f"正在压缩: {target}")
        if not compact_xcstrings(target):
            failures.append(target)

    if failures:
        print("❌ xcstrings 文件压缩失败:", file=sys.stderr)
        for path in failures:
            print(f"   - {path}", file=sys.stderr)
        sys.exit(1)

    print("✅ 完成 - xcstrings 文件压缩成功")


if __name__ == "__main__":
    main()
